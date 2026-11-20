import 'reflect-metadata';
import assert from 'node:assert/strict';
import {createHmac,randomBytes,randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {Module} from '@nestjs/common';
import {NestFactory} from '@nestjs/core';
import {GuestCompletionHttpController} from
 '../src/modules/guest-requests/guest-completion-http.controller.js';
import {GuestCompletionService} from
 '../src/modules/requests/guest-completion.service.js';
import {Client} from 'pg';
import {checkGlobalSendQuota} from '../src/modules/guest-requests/guest-global-quota.js';
import {checkContactSendQuota} from '../src/modules/guest-requests/guest-contact-quota.js';
import {GuestChallengeIssuanceService} from
 '../src/modules/guest-requests/guest-challenge-issuance.service.js';
import {GuestChallengeProofRepository} from
 '../src/modules/guest-requests/guest-challenge-proof.repository.js';
import {GuestChallengeVerificationService} from
 '../src/modules/guest-requests/guest-challenge-verification.service.js';
import {GuestOtpDispatchService} from
 '../src/modules/guest-requests/guest-otp-dispatch.service.js';
import {OtpDeliveryService} from
 '../src/modules/guest-requests/otp-delivery.service.js';
import {contactDigest,encryptGuestContact,hashGuestCapability,
 issueGuestCapability} from
 '../src/modules/guest-requests/guest-request.security.js';

test('guest re-OTP: READ_CANCEL starts but cannot grant completion; correct delivered code grants one-use request proof',async()=>{
 if(!process.env.DATABASE_URL)throw Error('DATABASE_URL required');
 const db=new Client({connectionString:process.env.DATABASE_URL});
 await db.connect();await db.query('BEGIN');
 const priorH=process.env.GUEST_REQUEST_HMAC_KEY;
 const priorE=process.env.GUEST_CONTACT_ENCRYPTION_KEY;
 const priorFlag=process.env.SERVICES_ENABLE_GUEST_COMPLETION_HTTP;
 const priorNetworkKey=process.env.GUEST_NETWORK_ATTESTATION_KEY;
 const pepper=randomBytes(32),encryptionKey=randomBytes(32);
 process.env.GUEST_REQUEST_HMAC_KEY=pepper.toString('base64');
 process.env.GUEST_CONTACT_ENCRYPTION_KEY=encryptionKey.toString('base64');
 try{
  const user=randomUUID(),person=randomUUID(),org=randomUUID();
  const def=randomUUID(),offer=randomUUID(),contactId=randomUUID(),request=randomUUID();
  const read=issueGuestCapability('READ_CANCEL',pepper);
  const email='guest-completion-'+randomBytes(8).toString('hex')+'@example.org';
  await db.query('INSERT INTO users(id) VALUES($1)',[user]);
  await db.query('INSERT INTO persons(id,user_id) VALUES($1,$2)',[person,user]);
  await db.query(`INSERT INTO organizations(id,owner_person_id,slug,name,status)
   VALUES($1,$2,$3,'Guest OTP complete seller','ACTIVE')`,
   [org,person,'otp-completion-'+randomUUID()]);
  await db.query(`INSERT INTO service_definitions(id,code,name)
   VALUES($1,$2,'Guest OTP completion')`,
   [def,'otp-completion-'+randomUUID()]);
  await db.query(`INSERT INTO service_offers
   (id,definition_id,organization_id,title,status,delivery_mode,contacts)
   VALUES($1,$2,$3,'Guest completion test offer','PUBLISHED','online','{}'::jsonb)`,
   [offer,def,org]);
  await db.query(`INSERT INTO guest_contacts
   (id,channel,encrypted_value,digest,verified_at,expires_at)
   VALUES($1,'email',$2,$3,now(),now()+interval '1 day')`,
   [contactId,encryptGuestContact(email,encryptionKey),
    contactDigest('email',email,pepper)]);
  await db.query(`INSERT INTO service_requests
   (id,offer_id,guest_contact_id,source_context,seller_organization_id,
   status,accepted_at,note)
   VALUES($1,$2,$3,'ORGANIZATION',$4,'ACCEPTED',now(),'SENSITIVE NOTE')`,
   [request,offer,contactId,org]);
  await db.query(`INSERT INTO guest_capabilities
   (id,guest_contact_id,request_id,scope,token_hash,expires_at)
   VALUES($1,$2,$3,'READ_CANCEL',$4,now()+interval '1 day')`,
   [randomUUID(),contactId,request,read.tokenHash]);

  const pool={
   transaction:async<T>(fn:(client:Client)=>Promise<T>)=>fn(db),
   query:async<T>(sql:string,args?:unknown[])=>db.query<T & import('pg').QueryResultRow>(sql,args),
  };
  let delivery:{code:string;purpose:string;destination:string}|undefined;
  const provider={deliverOtp:async(m:{code:string;purpose:string;destination:string})=>{
   delivery={code:m.code,purpose:m.purpose,destination:m.destination};
   return {accepted:true,providerRef:'test_completion_001'};
  }};
  const dispatch=new GuestOtpDispatchService(
   new GuestChallengeIssuanceService(pool as never),
   new OtpDeliveryService(provider),pool as never);
  const verification=new GuestChallengeVerificationService(
   new GuestChallengeProofRepository(pool as never));
  const network=randomBytes(32).toString('hex');
  const ingressKey=randomBytes(32);
  process.env.GUEST_NETWORK_ATTESTATION_KEY=ingressKey.toString('base64');
  process.env.SERVICES_ENABLE_GUEST_COMPLETION_HTTP='enabled';
  @Module({controllers:[GuestCompletionHttpController],providers:[
   {provide:GuestOtpDispatchService,useValue:dispatch},
   {provide:GuestChallengeVerificationService,useValue:verification},
   {provide:GuestCompletionService,useValue:new GuestCompletionService(pool as never)},
  ]})
  class IsolatedModule{}
  const app=await NestFactory.create(IsolatedModule,{logger:false});
  try{
   app.setGlobalPrefix('v1');
   await app.listen(0,'127.0.0.1');
   const root=(await app.getUrl())+'/v1/guest-requests/'+request+'/completion';
   const post=(path:string,headers:Record<string,string>,body:string)=>fetch(
    root+path,{method:'POST',headers:{'content-type':'application/json',...headers},
     body,redirect:'manual'});
   const timestamp=String(Date.now());
   const mac=createHmac('sha256',ingressKey)
    .update('services-otp-network:v1\n').update(network).update('\n')
    .update(timestamp).digest('hex');
   const ingress='v1.'+network+'.'+timestamp+'.'+mac;
   const issueResponse=await post('/challenges',{
    'guest-capability':read.token,'x-services-network-proof':ingress
   },'{"locale":"kk"}');
   assert.equal(issueResponse.status,202);
   assert.match(issueResponse.headers.get('cache-control')??'',/no-store/);
   const issueBody=await issueResponse.json() as {challenge_id:string};
   const issued={challengeId:issueBody.challenge_id};
   assert.ok(issued);
  assert.match(issued!.challengeId,/^[a-f0-9-]{36}$/i);
  assert.equal(delivery?.purpose,'COMPLETE_REQUEST');
  assert.equal(delivery?.destination,email);
  assert.match(delivery?.code??'',/^[0-9]{6}$/);
  const rows=await db.query<{purpose:string;attempts:number;consumed_at:Date|null}>(`
   SELECT purpose::text,attempts,consumed_at FROM guest_challenges WHERE id=$1`,
   [issued!.challengeId]);
  assert.deepEqual(rows.rows,[{purpose:'COMPLETE_REQUEST',attempts:0,consumed_at:null}]);
  const contactQuota=await checkContactSendQuota(db,contactDigest('email',email,pepper));
  assert.equal(contactQuota.allowed,false,
   'completion OTP must charge the same per-contact cooldown as creation and scheduling');
  assert.equal(contactQuota.reason,'cooldown');
  // Fill only with COMPLETE_REQUEST challenges: global quota must not ignore
  // this new purpose when counting the previous 60 seconds.
  for(let i=0;i<29;i++){
   await db.query(`INSERT INTO guest_challenges
    (id,guest_contact_id,request_id,code_hash,purpose,expires_at)
    VALUES($1,$2,$3,$4,'COMPLETE_REQUEST',now()+interval '10 minutes')`,
    [randomUUID(),contactId,request,randomBytes(32).toString('hex')]);
  }
  const globalQuota=await checkGlobalSendQuota(db);
  assert.equal(globalQuota.allowed,false);
  assert.equal(globalQuota.reason,'global_minute');

  // A valid code presented against the wrong request must not increment
  // attempts or consume the original request-bound challenge.
  await assert.rejects(verification.verifyCompleteRequest(
   randomUUID(),issued!.challengeId,delivery!.code),/Invalid or expired/);
  const crossRequest=await db.query<{attempts:number;consumed_at:Date|null}>(`
   SELECT attempts,consumed_at FROM guest_challenges WHERE id=$1`,
   [issued!.challengeId]);
  assert.deepEqual(crossRequest.rows,[{attempts:0,consumed_at:null}]);
  assert.equal((await db.query(`SELECT id FROM guest_capabilities
   WHERE scope='COMPLETE_REQUEST' AND request_id=$1`,[request])).rowCount,0);
  await assert.rejects(verification.verifyCompleteRequest(
   request,issued!.challengeId,'wrong'),/Invalid or expired/);
  const wrong=delivery!.code==='999999'?'999998':'999999';
  await assert.rejects(verification.verifyCompleteRequest(
   request,issued!.challengeId,wrong),/Invalid or expired/);
  const count=await db.query<{attempts:number}>(`
   SELECT attempts FROM guest_challenges WHERE id=$1`,[issued!.challengeId]);
  assert.equal(count.rows[0]?.attempts,1);
  const verifyResponse=await post(
   '/challenges/'+issued.challengeId+'/verify',{},
   JSON.stringify({code:delivery!.code}));
  assert.equal(verifyResponse.status,200);
  assert.match(verifyResponse.headers.get('cache-control')??'',/no-store/);
  const verifyBody=await verifyResponse.json() as {guest_capability:string};
  const verified={guestCapability:verifyBody.guest_capability};
  assert.match(verified.guestCapability,/^[A-Za-z0-9_-]{43}$/);
  const proofs=await db.query<{scope:string;request_id:string;token_hash:string}>(`
   SELECT scope::text,request_id::text,token_hash FROM guest_capabilities
   WHERE token_hash=$1`,[hashGuestCapability('COMPLETE_REQUEST',
    verified.guestCapability,pepper)]);
  assert.deepEqual(proofs.rows,[{scope:'COMPLETE_REQUEST',request_id:request,
   token_hash:hashGuestCapability('COMPLETE_REQUEST',verified.guestCapability,pepper)}]);
  await assert.rejects(verification.verifyCompleteRequest(
   request,issued!.challengeId,delivery!.code),/Invalid or expired/);
  const deniedRead=await post('/confirm',{
   'guest-completion-capability':read.token,'If-Match':'"1"'
  },'{}');
  assert.equal(deniedRead.status,404,'READ_CANCEL must never complete');
  const completedResponse=await post('/confirm',{
   'guest-completion-capability':verified.guestCapability,'If-Match':'"1"'
  },'{}');
  assert.equal(completedResponse.status,200);
  assert.match(completedResponse.headers.get('cache-control')??'',/no-store/);
  assert.deepEqual(await completedResponse.json(),
   {id:request,state:'completed',version:2});
  const replay=await post('/confirm',{
   'guest-completion-capability':verified.guestCapability,'If-Match':'"2"'
  },'{}');
  assert.equal(replay.status,404,'consumed completion proof cannot replay');
  assert.equal((await db.query('SELECT id FROM service_experiences WHERE request_id=$1',
   [request])).rowCount,0,'no Person-backed review entitlement');
  assert.equal((await db.query('SELECT id FROM guest_capabilities WHERE token_hash=$1 AND consumed_at IS NOT NULL',
   [hashGuestCapability('COMPLETE_REQUEST',verified.guestCapability,pepper)])).rowCount,1);
  // No new challenge for already completed request even with old READ_CANCEL.
  assert.equal(await dispatch.dispatchCompleteRequest(
   request,read.token,'kk',randomBytes(32).toString('hex')),null);
  assert.equal((await db.query('SELECT id FROM domain_outbox_events WHERE subject_id=$1',
   [request])).rowCount,1);
  }finally{await app.close();}
 }finally{
  await db.query('ROLLBACK').catch(()=>{});await db.end();
  if(priorH===undefined)delete process.env.GUEST_REQUEST_HMAC_KEY;
  else process.env.GUEST_REQUEST_HMAC_KEY=priorH;
  if(priorE===undefined)delete process.env.GUEST_CONTACT_ENCRYPTION_KEY;
  else process.env.GUEST_CONTACT_ENCRYPTION_KEY=priorE;
  if(priorFlag===undefined)delete process.env.SERVICES_ENABLE_GUEST_COMPLETION_HTTP;
  else process.env.SERVICES_ENABLE_GUEST_COMPLETION_HTTP=priorFlag;
  if(priorNetworkKey===undefined)delete process.env.GUEST_NETWORK_ATTESTATION_KEY;
  else process.env.GUEST_NETWORK_ATTESTATION_KEY=priorNetworkKey;
 }
});
