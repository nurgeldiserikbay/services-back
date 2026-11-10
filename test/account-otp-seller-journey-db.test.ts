import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {Client} from 'pg';
import {UnauthorizedException} from '@nestjs/common';
import {issueAccountOtpChallenge} from '../src/modules/identity/account-otp-issuance.js';
import {signInWithVerifiedAccountOtp} from '../src/modules/identity/account-otp-sign-in.js';
import {resolveActiveUserSession} from '../src/modules/identity/session-proof.js';
import {listMyAccountSessions} from '../src/modules/identity/account-session-management.js';
import {revokeCurrentAccountSession} from '../src/modules/identity/session-revocation.js';
import {readSellerInbox} from '../src/modules/requests/seller-inbox.repository.js';
import {parseSellerInboxFilter} from '../src/modules/requests/seller-inbox.contract.js';
import {decideWithIdempotentSession} from '../src/modules/requests/seller-decision-idempotent.js';
import {SellerDecisionRejected} from '../src/modules/requests/seller-decision.transaction.js';

const keys=()=>({
  otpPepper:randomBytes(32),contactPepper:randomBytes(32),
  contactKey:randomBytes(32),sessionPepper:randomBytes(32),
});
async function begin(){
  const db=new Client({connectionString:process.env.DATABASE_URL});
  await db.connect();
  await db.query('BEGIN');
  return db;
}
async function prepareOrgRequest(db:Client,ownerId:string){
  const personId=randomUUID(),orgId=randomUUID(),offerId=randomUUID();
  const definitionId=randomUUID(),guestId=randomUUID(),requestId=randomUUID();
  const foreignId=randomUUID();
  await db.query('INSERT INTO persons(id,user_id) VALUES($1,$2)',[personId,ownerId]);
  await db.query(`INSERT INTO organizations(id,owner_person_id,slug,name,status)
    VALUES($1,$2,$3,'OTP integration test','ACTIVE')`,
    [orgId,personId,'otp-journey-'+randomUUID()]);
  await db.query(`INSERT INTO organization_members(id,organization_id,user_id,role)
    VALUES($1,$2,$3,'ADMIN')`,[randomUUID(),orgId,ownerId]);
  await db.query('INSERT INTO service_definitions(id,code,name) VALUES($1,$2,$3)',
    [definitionId,'otp-e2e-'+randomUUID(),'Test service']);
  await db.query(`INSERT INTO service_offers(
    id,definition_id,organization_id,title,status,delivery_mode,contacts
    ) VALUES($1,$2,$3,'Bookable service','PUBLISHED','online','{}'::jsonb)`,
    [offerId,definitionId,orgId]);
  await db.query(`INSERT INTO guest_contacts
    (id,channel,encrypted_value,digest,verified_at,expires_at)
    VALUES($1,'email','encrypted',$2,now(),now()+interval '1 day')`,
    [guestId,'otp-journey-'+randomUUID()]);
  await db.query(`INSERT INTO service_requests
    (id,offer_id,guest_contact_id,source_context,seller_organization_id,status)
    VALUES($1,$2,$3,'ORGANIZATION',$4,'PENDING')`,
    [requestId,offerId,guestId,orgId]);
  return {orgId,requestId,guestId,foreignId};
}
async function verifiedAccountToken(db:Client,userId:string,email:string,
  secret:ReturnType<typeof keys>){
  await db.query('INSERT INTO users(id,email) VALUES($1,$2)',[userId,email]);
  const challenge=await issueAccountOtpChallenge(db,{
    channel:'EMAIL',purpose:'SIGN_IN',contact:email,
  },secret);
  // Simulates an approved provider acceptance, NEVER a public caller action.
  await db.query(`UPDATE account_auth_challenges
    SET delivery_confirmed_at=now() WHERE id=$1 AND consumed_at IS NULL`,
    [challenge.challengeId]);
  const proof=await signInWithVerifiedAccountOtp(db,{
    challengeId:challenge.challengeId,channel:'EMAIL',code:challenge.code,
  },secret);
  assert.ok(proof);
  return {token:proof.sessionToken,challenge};
}

test('confirmed account OTP -> bearer -> seller inbox -> accept -> notification and idempotent replay',async()=>{
  const db=await begin(),secret=keys(),ownerId=randomUUID();
  try{
    const login=await verifiedAccountToken(
      db,ownerId,'seller-e2e-'+randomUUID()+'@example.test',secret);
    const f=await prepareOrgRequest(db,ownerId);
    const actor=await resolveActiveUserSession(db,login.token,secret.sessionPepper);
    assert.equal(actor?.userId,ownerId);
    const sessions=await listMyAccountSessions(db,login.token,secret.sessionPepper);
    assert.equal(sessions?.length,1);
    assert.equal(sessions?.[0].current,true);
    assert.equal(JSON.stringify(sessions).includes(login.token),false);
    const filter=parseSellerInboxFilter({state:'pending',limit:'20'});
    const before=await readSellerInbox(db,actor!.userId,filter);
    assert.deepEqual(before.items.map(x=>x.id),[f.requestId]);
    assert.equal(before.items[0].seller_kind,'organization');
    // An unrelated, otherwise valid account session cannot view or decide
    // another organization's pending request.
    const outsiderId=randomUUID();
    const outsider=await verifiedAccountToken(db,outsiderId,
      'outsider-e2e-'+randomUUID()+'@example.test',secret);
    assert.deepEqual((await readSellerInbox(db,outsiderId,filter)).items,[]);
    await assert.rejects(decideWithIdempotentSession(
      db,outsider.token,f.requestId,'accept',1,randomUUID(),secret.sessionPepper),
      (e:unknown)=>e instanceof SellerDecisionRejected&&e.reason==='forbidden');
    const stillPending=await db.query<{status:string;version:number}>(
      'SELECT status,version FROM service_requests WHERE id=$1',[f.requestId]);
    assert.deepEqual(stillPending.rows[0],{status:'PENDING',version:1});
    const key=randomUUID();
    const accepted=await decideWithIdempotentSession(
      db,login.token,f.requestId,'accept',1,key,secret.sessionPepper);
    assert.deepEqual(accepted,{
      id:f.requestId,state:'accepted',version:2,replayed:false,
    });
    const replay=await decideWithIdempotentSession(
      db,login.token,f.requestId,'accept',1,key,secret.sessionPepper);
    assert.deepEqual(replay,{...accepted,replayed:true});
    const after=await readSellerInbox(db,actor!.userId,filter);
    assert.deepEqual(after.items,[]);
    const row=await db.query<{status:string;version:number;scheduled_start_at:Date|null}>(`
      SELECT status,version,scheduled_start_at FROM service_requests WHERE id=$1`,
      [f.requestId]);
    assert.equal(row.rows[0].status,'ACCEPTED');
    assert.equal(row.rows[0].version,2);
    assert.equal(row.rows[0].scheduled_start_at,null);
    const events=await db.query<{n:string}>(`
      SELECT count(*)::text AS n FROM domain_outbox_events
      WHERE subject_id=$1 AND topic='service_request.accepted'`,[f.requestId]);
    assert.equal(events.rows[0].n,'1');
    const notices=await db.query<{n:string}>(`
      SELECT count(*)::text AS n FROM notification_intents
      WHERE dedupe_key=$1`,['request-accept:guest:'+f.requestId]);
    assert.equal(notices.rows[0].n,'1');
    const replayAgain=await decideWithIdempotentSession(
      db,login.token,f.requestId,'accept',1,key,secret.sessionPepper);
    assert.deepEqual(replayAgain,{...accepted,replayed:true});
    const eventsAfterReplay=await db.query<{n:string}>(`
      SELECT count(*)::text AS n FROM domain_outbox_events
      WHERE subject_id=$1 AND topic='service_request.accepted'`,[f.requestId]);
    assert.equal(eventsAfterReplay.rows[0].n,'1');
    const noticesAfterReplay=await db.query<{n:string}>(`
      SELECT count(*)::text AS n FROM notification_intents
      WHERE dedupe_key=$1`,['request-accept:guest:'+f.requestId]);
    assert.equal(noticesAfterReplay.rows[0].n,'1');
  }finally{await db.query('ROLLBACK').catch(()=>{});await db.end();}
});

test('revoked seller membership denies both new decisions and idempotency replay',async()=>{
  const db=await begin(),secret=keys(),ownerId=randomUUID();
  try{
    const login=await verifiedAccountToken(
      db,ownerId,'role-e2e-'+randomUUID()+'@example.test',secret);
    const f=await prepareOrgRequest(db,ownerId);
    const key=randomUUID();
    const accepted=await decideWithIdempotentSession(
      db,login.token,f.requestId,'decline',1,key,secret.sessionPepper);
    assert.equal(accepted.state,'declined');
    await db.query(`UPDATE organization_members SET revoked_at=now()
      WHERE user_id=$1 AND organization_id=$2`,[ownerId,f.orgId]);
    assert.deepEqual((await readSellerInbox(db,ownerId,
      parseSellerInboxFilter({}))).items,[]);
    await assert.rejects(decideWithIdempotentSession(
      db,login.token,f.requestId,'decline',1,key,secret.sessionPepper),
      (e:unknown)=>e instanceof SellerDecisionRejected&&e.reason==='forbidden');
  }finally{await db.query('ROLLBACK').catch(()=>{});await db.end();}
});

test('logout revokes OTP-issued account bearer for inbox and seller decisions',async()=>{
  const db=await begin(),secret=keys(),ownerId=randomUUID();
  try{
    const login=await verifiedAccountToken(
      db,ownerId,'logout-e2e-'+randomUUID()+'@example.test',secret);
    const f=await prepareOrgRequest(db,ownerId);
    assert.equal(await revokeCurrentAccountSession(
      db,login.token,secret.sessionPepper),true);
    assert.equal(await resolveActiveUserSession(db,login.token,secret.sessionPepper),null);
    assert.equal(await listMyAccountSessions(db,login.token,secret.sessionPepper),null);
    await assert.rejects(decideWithIdempotentSession(
      db,login.token,f.requestId,'accept',1,randomUUID(),secret.sessionPepper),
      UnauthorizedException);
    assert.equal(await revokeCurrentAccountSession(
      db,login.token,secret.sessionPepper),false);
    const request=await db.query<{status:string}>(`
      SELECT status FROM service_requests WHERE id=$1`,[f.requestId]);
    assert.equal(request.rows[0].status,'PENDING');
  }finally{await db.query('ROLLBACK').catch(()=>{});await db.end();}
});

test('unrelated OTP-authenticated account cannot view or decide another seller request',async()=>{
  const db=await begin(),secret=keys(),ownerId=randomUUID(),outsiderId=randomUUID();
  try{
    const owner=await verifiedAccountToken(
      db,ownerId,'owner-isolation-'+randomUUID()+'@example.test',secret);
    const outsider=await verifiedAccountToken(
      db,outsiderId,'outsider-isolation-'+randomUUID()+'@example.test',secret);
    const fixture=await prepareOrgRequest(db,ownerId);
    const outsiderInbox=await readSellerInbox(db,outsiderId,
      parseSellerInboxFilter({state:'pending',limit:'20'}));
    assert.deepEqual(outsiderInbox.items,[]);
    await assert.rejects(
      decideWithIdempotentSession(db,outsider.token,fixture.requestId,
        'accept',1,randomUUID(),secret.sessionPepper),
      (error:unknown)=>error instanceof SellerDecisionRejected&&error.reason==='forbidden',
    );
    await assert.rejects(
      decideWithIdempotentSession(db,outsider.token,fixture.requestId,
        'decline',1,randomUUID(),secret.sessionPepper),
      (error:unknown)=>error instanceof SellerDecisionRejected&&error.reason==='forbidden',
    );
    const stillPending=await db.query<{status:string;version:number}>(`
      SELECT status,version FROM service_requests WHERE id=$1`,[fixture.requestId]);
    assert.deepEqual(stillPending.rows[0],{status:'PENDING',version:1});
    const forbiddenEvents=await db.query<{n:string}>(`
      SELECT count(*)::text AS n FROM domain_outbox_events
      WHERE subject_id=$1 AND topic='service_request.accepted'`,[fixture.requestId]);
    assert.equal(forbiddenEvents.rows[0].n,'0');
    const forbiddenNotices=await db.query<{n:string}>(`
      SELECT count(*)::text AS n FROM notification_intents
      WHERE dedupe_key=$1`,['request-accept:guest:'+fixture.requestId]);
    assert.equal(forbiddenNotices.rows[0].n,'0');
    const declinedEvents=await db.query<{n:string}>(`
      SELECT count(*)::text AS n FROM domain_outbox_events
      WHERE subject_id=$1 AND topic='service_request.declined'`,[fixture.requestId]);
    assert.equal(declinedEvents.rows[0].n,'0');
    const declinedNotices=await db.query<{n:string}>(`
      SELECT count(*)::text AS n FROM notification_intents
      WHERE dedupe_key LIKE $1`,['request-decline:%'+fixture.requestId]);
    assert.equal(declinedNotices.rows[0].n,'0');
    const ownerInbox=await readSellerInbox(db,ownerId,
      parseSellerInboxFilter({state:'pending',limit:'20'}));
    assert.deepEqual(ownerInbox.items.map(item=>item.id),[fixture.requestId]);
    assert.ok(owner.token);
  }finally{await db.query('ROLLBACK').catch(()=>{});await db.end();}
});
