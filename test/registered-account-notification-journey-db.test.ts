import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {Client} from 'pg';
import {UnauthorizedException} from '@nestjs/common';
import {issueAccountOtpChallenge} from '../src/modules/identity/account-otp-issuance.js';
import {signInWithVerifiedAccountOtp} from '../src/modules/identity/account-otp-sign-in.js';
import {decideWithIdempotentSession} from '../src/modules/requests/seller-decision-idempotent.js';
import {processInAppNotificationBatch} from '../src/modules/notifications/in-app-pipeline.js';
import {PersonInboxService} from '../src/modules/notifications/person-inbox.service.js';
import {PersonInboxController} from '../src/modules/notifications/person-inbox.controller.js';
import {revokeCurrentAccountSession} from '../src/modules/identity/session-revocation.js';

function freshSecrets(){
 return {
  otpPepper:randomBytes(32),contactPepper:randomBytes(32),
  contactKey:randomBytes(32),sessionPepper:randomBytes(32),
 };
}
type Secrets=ReturnType<typeof freshSecrets>;
async function verifiedAccount(db:Client,email:string,secrets:Secrets){
 const userId=randomUUID(),personId=randomUUID();
 await db.query('INSERT INTO users(id,email) VALUES($1,$2)',[userId,email]);
 await db.query('INSERT INTO persons(id,user_id) VALUES($1,$2)',[personId,userId]);
 const challenge=await issueAccountOtpChallenge(db,{
  channel:'EMAIL',purpose:'SIGN_IN',contact:email,
 },secrets);
 // Test-only trusted provider acceptance; never exposed to an HTTP client.
 await db.query(`UPDATE account_auth_challenges
   SET delivery_confirmed_at=now() WHERE id=$1 AND consumed_at IS NULL`,
  [challenge.challengeId]);
 const session=await signInWithVerifiedAccountOtp(db,{
  challengeId:challenge.challengeId,channel:'EMAIL',code:challenge.code,
 },secrets);
 assert.ok(session);
 return {userId,personId,sessionToken:session.sessionToken};
}
async function prepareRequest(db:Client,seller:{userId:string;personId:string},
 customer:{personId:string}){
 const orgId=randomUUID(),definitionId=randomUUID();
 const offerId=randomUUID(),requestId=randomUUID();
 await db.query(`INSERT INTO organizations(id,owner_person_id,slug,name,status)
 VALUES($1,$2,$3,'Account journey seller','ACTIVE')`,
 [orgId,seller.personId,'account-notify-'+randomUUID()]);
 await db.query(`INSERT INTO organization_members(id,organization_id,user_id,role)
 VALUES($1,$2,$3,'ADMIN')`,[randomUUID(),orgId,seller.userId]);
 await db.query('INSERT INTO service_definitions(id,code,name) VALUES($1,$2,$3)',
  [definitionId,'account-notify-'+randomUUID(),'Test service']);
 await db.query(`INSERT INTO service_offers
 (id,definition_id,organization_id,title,status,delivery_mode,contacts)
 VALUES($1,$2,$3,'Test offer','PUBLISHED','online','{}'::jsonb)`,
 [offerId,definitionId,orgId]);
 await db.query(`INSERT INTO service_requests
 (id,offer_id,customer_person_id,source_context,seller_organization_id,status)
 VALUES($1,$2,$3,'ORGANIZATION',$4,'PENDING')`,
 [requestId,offerId,customer.personId,orgId]);
 return {orgId,requestId};
}

test('confirmed OTP -> seller accepts registered request -> customer IN_APP inbox -> logout denies',async()=>{
 const db=new Client({connectionString:process.env.DATABASE_URL});
 await db.connect();await db.query('BEGIN');
 const secrets=freshSecrets(),old=process.env.ACCOUNT_SESSION_HMAC_KEY;
 process.env.ACCOUNT_SESSION_HMAC_KEY=secrets.sessionPepper.toString('base64');
 try{
  const seller=await verifiedAccount(db,'seller-notify-'+randomUUID()+'@example.test',secrets);
  const customer=await verifiedAccount(db,'buyer-notify-'+randomUUID()+'@example.test',secrets);
  const {requestId}=await prepareRequest(db,seller,customer);
  const nonce=randomUUID();
  const accepted=await decideWithIdempotentSession(
   db,seller.sessionToken,requestId,'accept',1,nonce,secrets.sessionPepper);
  assert.deepEqual(accepted,{id:requestId,state:'accepted',version:2,replayed:false});
  const replay=await decideWithIdempotentSession(
   db,seller.sessionToken,requestId,'accept',1,nonce,secrets.sessionPepper);
  assert.deepEqual(replay,{...accepted,replayed:true});
  const notices=await db.query<{n:string;channel:string;recipient_person_id:string}>(`
   SELECT count(*)::text n,max(channel) channel,
    max(recipient_person_id::text) recipient_person_id
   FROM notification_intents WHERE dedupe_key=$1`,
  ['request-accept:client:'+requestId]);
  assert.equal(notices.rows[0].n,'1');
  assert.equal(notices.rows[0].channel,'IN_APP');
  assert.equal(notices.rows[0].recipient_person_id,customer.personId);
  const staged=await processInAppNotificationBatch(db,25);
  assert.equal(staged.deliveryRowsStaged,1);
  assert.equal(staged.inAppDeliveriesMaterialized,1);
  assert.deepEqual(await processInAppNotificationBatch(db,25),{
   outboxEventsVisited:0,deliveryRowsStaged:0,inAppDeliveriesMaterialized:0,
  });
  const pool={transaction:async<T>(run:(client:Client)=>Promise<T>)=>run(db)};
  const controller=new PersonInboxController(new PersonInboxService(pool as never));
  const buyerView=await controller.list('Bearer '+customer.sessionToken,'20');
  assert.equal(buyerView.items.length,1);
  assert.equal(buyerView.items[0].topic,'service_request.accepted');
  assert.equal(buyerView.items[0].subject_id,requestId);
  assert.equal(JSON.stringify(buyerView).includes(customer.sessionToken),false);
  assert.deepEqual((await controller.list('Bearer '+seller.sessionToken,'20')).items,[]);
  // A separate verified account cannot read the customer's notification.
  const outsider=await verifiedAccount(db,
   'outsider-notify-'+randomUUID()+'@example.test',secrets);
  assert.deepEqual((await controller.list('Bearer '+outsider.sessionToken,'20')).items,[]);
  const req=await db.query<{status:string;scheduled_start_at:Date|null}>(`
   SELECT status,scheduled_start_at FROM service_requests WHERE id=$1`,[requestId]);
  assert.equal(req.rows[0].status,'ACCEPTED');
  assert.equal(req.rows[0].scheduled_start_at,null);
  assert.equal(await revokeCurrentAccountSession(
   db,customer.sessionToken,secrets.sessionPepper),true);
  await assert.rejects(controller.list('Bearer '+customer.sessionToken,'20'),
   UnauthorizedException);
  // Revoking access must not delete the durable notification for the customer.
  const durable=await db.query<{n:string}>(`
   SELECT count(*)::text AS n FROM notification_intents
   WHERE dedupe_key=$1 AND recipient_person_id=$2`,
   ['request-accept:client:'+requestId,customer.personId]);
  assert.equal(durable.rows[0].n,'1');
  assert.deepEqual((await controller.list('Bearer '+seller.sessionToken,'20')).items,[]);
 }finally{
  if(old===undefined)delete process.env.ACCOUNT_SESSION_HMAC_KEY;
  else process.env.ACCOUNT_SESSION_HMAC_KEY=old;
  await db.query('ROLLBACK').catch(()=>{});await db.end();
 }
});
