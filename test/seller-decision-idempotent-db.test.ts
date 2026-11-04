import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {Client} from 'pg';
import {issueSessionToken} from '../src/modules/identity/session-proof.js';
import {decideWithIdempotentSession} from '../src/modules/requests/seller-decision-idempotent.js';
import {SellerDecisionRejected} from '../src/modules/requests/seller-decision.transaction.js';

test('seller bearer decision is transactional, idempotent, scoped and audited by events',async()=>{
 const db=new Client({connectionString:process.env.DATABASE_URL});
 await db.connect();await db.query('BEGIN');
 try {
  const pepper=randomBytes(32);
  const userId=randomUUID(),personId=randomUUID(),orgId=randomUUID();
  const memberId=randomUUID(),definitionId=randomUUID(),offerId=randomUUID();
  const guestId=randomUUID(),requestId=randomUUID(),sessionId=randomUUID();
  const {token,hash}=issueSessionToken(pepper);
  await db.query('INSERT INTO users(id) VALUES($1)',[userId]);
  await db.query('INSERT INTO persons(id,user_id) VALUES($1,$2)',[personId,userId]);
  await db.query(`INSERT INTO organizations(id,owner_person_id,slug,name,status)
    VALUES($1,$2,$3,'Decision test','ACTIVE')`,
    [orgId,personId,'seller-decision-http-'+randomUUID()]);
  await db.query(`INSERT INTO organization_members(id,organization_id,user_id,role)
    VALUES($1,$2,$3,'ADMIN')`,[memberId,orgId,userId]);
  await db.query('INSERT INTO service_definitions(id,code,name) VALUES($1,$2,$3)',
    [definitionId,'seller-http-'+randomUUID(),'Service']);
  await db.query(`INSERT INTO service_offers
    (id,definition_id,organization_id,title,status,delivery_mode,contacts)
    VALUES($1,$2,$3,'Offer','PUBLISHED','online','{}'::jsonb)`,
    [offerId,definitionId,orgId]);
  await db.query(`INSERT INTO guest_contacts
    (id,channel,encrypted_value,digest,verified_at,expires_at)
    VALUES($1,'email','encrypted',$2,now(),now()+interval '1 day')`,
    [guestId,'seller-http-'+randomUUID()]);
  await db.query(`INSERT INTO service_requests
    (id,offer_id,guest_contact_id,source_context,seller_organization_id,status)
    VALUES($1,$2,$3,'ORGANIZATION',$4,'PENDING')`,
    [requestId,offerId,guestId,orgId]);
  await db.query(`INSERT INTO sessions(id,user_id,token_hash,family_id,expires_at)
    VALUES($1,$2,$3,$4,now()+interval '1 day')`,
    [sessionId,userId,hash,randomUUID()]);
  const key='key_12345678912345';
  const first=await decideWithIdempotentSession(db,token,requestId,'accept',1,key,pepper);
  assert.deepEqual(first,{id:requestId,state:'accepted',version:2,replayed:false});
  const retry=await decideWithIdempotentSession(db,token,requestId,'accept',1,key,pepper);
  assert.deepEqual(retry,{id:requestId,state:'accepted',version:2,replayed:true});
  await assert.rejects(decideWithIdempotentSession(
    db,token,requestId,'accept',2,key,pepper),
    (e:unknown)=>e instanceof SellerDecisionRejected&&e.reason==='conflict');
  const notifications=await db.query<{count:string}>(
    'SELECT count(*)::text AS count FROM notification_intents WHERE dedupe_key=$1',
    ['request-accept:guest:'+requestId]);
  assert.equal(notifications.rows[0].count,'1');
  const ledger=await db.query<{response_body:unknown}>(`
    SELECT response_body FROM idempotency_records
    WHERE actor_scope=$1 AND key=$2
  `,['seller:'+userId,key]);
  assert.equal(ledger.rows.length,1);
  assert.ok(!JSON.stringify(ledger.rows[0].response_body).includes(token));
  await db.query('UPDATE organization_members SET revoked_at=now() WHERE id=$1',[memberId]);
  await assert.rejects(decideWithIdempotentSession(
    db,token,requestId,'accept',1,key,pepper),
    (e:unknown)=>e instanceof SellerDecisionRejected&&e.reason==='forbidden');
 }finally{
  await db.query('ROLLBACK').catch(()=>{});
  await db.end();
 }
});
