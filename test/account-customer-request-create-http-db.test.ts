import 'reflect-metadata';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {BadRequestException,Module,NotFoundException,UnauthorizedException} from '@nestjs/common';
import {NestFactory} from '@nestjs/core';
import {Client} from 'pg';
import {AccountCustomerRequestCreateController} from
 '../src/modules/identity/account-customer-request-create.controller.js';
import {AccountBearerSessionService} from
 '../src/modules/identity/account-bearer-session.service.js';
import {issueSessionToken} from '../src/modules/identity/session-proof.js';

const uuid=()=>randomUUID();
const key='registered_http_create_20261123_001';

test('registered request creation stays disabled by default and rejects malformed transport before DB',async()=>{
 const previous=process.env.SERVICES_ENABLE_REGISTERED_REQUEST_CREATE_HTTP;
 const token='a'.repeat(43),offer=uuid();
 let calls=0;
 const controller=new AccountCustomerRequestCreateController({
  createOwnRequest:async()=>{calls++;return {id:uuid(),state:'pending',version:1};},
 } as never);
 try{
  delete process.env.SERVICES_ENABLE_REGISTERED_REQUEST_CREATE_HTTP;
  await assert.rejects(controller.create('Bearer '+token,key,{
   service_offer_id:offer,consent_to_contact:true,
  }),NotFoundException);
  process.env.SERVICES_ENABLE_REGISTERED_REQUEST_CREATE_HTTP='enabled';
  for(const invalid of [undefined,'Basic bad','Bearer bad']){
   await assert.rejects(controller.create(invalid,key,{
    service_offer_id:offer,consent_to_contact:true,
   }),UnauthorizedException);
  }
  for(const invalid of [undefined,'a','a'.repeat(129)]){
   await assert.rejects(controller.create('Bearer '+token,invalid,{
    service_offer_id:offer,consent_to_contact:true,
   }),BadRequestException);
  }
  for(const bad of [
   {},{service_offer_id:offer,consent_to_contact:false},
   {service_offer_id:offer,consent_to_contact:true,customer_person_id:uuid()},
   {service_offer_id:offer,consent_to_contact:true,note:123},
  ]){
   await assert.rejects(controller.create('Bearer '+token,key,bad),BadRequestException);
  }
  assert.equal(calls,0);
 }finally{
  if(previous===undefined)delete process.env.SERVICES_ENABLE_REGISTERED_REQUEST_CREATE_HTTP;
  else process.env.SERVICES_ENABLE_REGISTERED_REQUEST_CREATE_HTTP=previous;
 }
});

test('real Nest HTTP and PostgreSQL create once for active own bearer, reject replay conflict and revocation',async()=>{
 if(!process.env.DATABASE_URL)throw Error('DATABASE_URL required');
 const db=new Client({connectionString:process.env.DATABASE_URL});
 await db.connect();await db.query('BEGIN');
 const previousPepper=process.env.ACCOUNT_SESSION_HMAC_KEY;
 const previousFlag=process.env.SERVICES_ENABLE_REGISTERED_REQUEST_CREATE_HTTP;
 const pepper=randomBytes(32);
 process.env.ACCOUNT_SESSION_HMAC_KEY=pepper.toString('base64');
 process.env.SERVICES_ENABLE_REGISTERED_REQUEST_CREATE_HTTP='enabled';
 const owner=issueSessionToken(pepper);
 const customerUser=uuid(),customerPerson=uuid(),sellerUser=uuid(),sellerPerson=uuid();
 const org=uuid(),definition=uuid(),offer=uuid();
 let app:Awaited<ReturnType<typeof NestFactory.create>>|undefined;
 try{
  await db.query('INSERT INTO users(id) VALUES($1),($2)',[customerUser,sellerUser]);
  await db.query('INSERT INTO persons(id,user_id) VALUES($1,$2),($3,$4)',
   [customerPerson,customerUser,sellerPerson,sellerUser]);
  await db.query(`INSERT INTO sessions(id,user_id,token_hash,family_id,expires_at)
   VALUES($1,$2,$3,$4,now()+interval '1 day')`,
   [uuid(),customerUser,owner.hash,uuid()]);
  await db.query(`INSERT INTO organizations
   (id,owner_person_id,slug,name,status)
   VALUES($1,$2,$3,'Registered HTTP seller','ACTIVE')`,
   [org,sellerPerson,'registered-http-'+uuid()]);
  await db.query(`INSERT INTO service_definitions(id,code,name)
   VALUES($1,$2,'Registered HTTP service')`,
   [definition,'registered-http-'+uuid()]);
  await db.query(`INSERT INTO service_offers
   (id,definition_id,organization_id,title,status,delivery_mode,contacts)
   VALUES($1,$2,$3,'Registered HTTP offer','PUBLISHED','online','{}'::jsonb)`,
   [offer,definition,org]);
  const service=new AccountBearerSessionService({
   transaction:async<T>(work:(client:Client)=>Promise<T>)=>work(db),
  } as never);
  @Module({controllers:[AccountCustomerRequestCreateController],
   providers:[{provide:AccountBearerSessionService,useValue:service}]})
  class IsolatedRegisteredCreateModule{}
  app=await NestFactory.create(IsolatedRegisteredCreateModule,{logger:false});
  app.setGlobalPrefix('v1');
  await app.listen(0,'127.0.0.1');
  const url=(await app.getUrl())+'/v1/account/requests';
  const send=(bearer:string,idem:string,body:object)=>fetch(url,{
   method:'POST',
   headers:{'Authorization':bearer,'Idempotency-Key':idem,
    'Content-Type':'application/json'},
   body:JSON.stringify(body),redirect:'manual',
  });
  const body={service_offer_id:offer,note:'Account private note',consent_to_contact:true};
  const noBearer=await send('Basic bad',key,body);
  assert.equal(noBearer.status,401);
  const forged=await send('Bearer '+owner.token,key,{...body,customer_person_id:uuid()});
  assert.equal(forged.status,400);
  assert.equal((await db.query<{n:string}>(
   'SELECT count(*)::text AS n FROM service_requests WHERE customer_person_id=$1',
   [customerPerson])).rows[0]?.n,'0');

  const first=await send('Bearer '+owner.token,key,body);
  assert.equal(first.status,201);
  assert.match(first.headers.get('cache-control')??'',/no-store/);
  const receipt=await first.json() as {id:string;state:string;version:number};
  assert.equal(receipt.state,'pending');
  assert.equal(receipt.version,1);
  assert.match(receipt.id,/^[0-9a-f-]{36}$/);
  const repeated=await send('Bearer '+owner.token,key,body);
  assert.equal(repeated.status,201);
  assert.deepEqual(await repeated.json(),receipt);
  const conflict=await send('Bearer '+owner.token,key,{...body,note:'Changed'});
  assert.equal(conflict.status,409);
  const counts=await db.query<{requests:string;outbox:string;notices:string}>(`
   SELECT
    (SELECT count(*)::text FROM service_requests WHERE id=$1) AS requests,
    (SELECT count(*)::text FROM domain_outbox_events
     WHERE subject_id=$1 AND topic='service_request.created') AS outbox,
    (SELECT count(*)::text FROM notification_intents
     WHERE dedupe_key=$2) AS notices
  `,[receipt.id,'request-created:seller:'+receipt.id]);
  assert.deepEqual(counts.rows[0],{requests:'1',outbox:'1',notices:'1'});
  const stored=await db.query<{customer_person_id:string;guest_contact_id:string|null}>(
   'SELECT customer_person_id::text,guest_contact_id::text FROM service_requests WHERE id=$1',
   [receipt.id]);
  assert.equal(stored.rows[0]?.customer_person_id,customerPerson);
  assert.equal(stored.rows[0]?.guest_contact_id,null);

  // The real frontend form sends note:null when the comment is empty.
  // This must pass the same live bearer and PostgreSQL creation path.
  const blankKey='registered_http_create_20261123_null_note';
  const blankBody={service_offer_id:offer,note:null,consent_to_contact:true};
  const blank=await send('Bearer '+owner.token,blankKey,blankBody);
  assert.equal(blank.status,201,'explicit null note from BFF must be accepted');
  const blankReceipt=await blank.json() as {id:string;state:string;version:number};
  assert.equal(blankReceipt.state,'pending');
  assert.equal(blankReceipt.version,1);
  assert.notEqual(blankReceipt.id,receipt.id);
  const blankPersisted=await db.query<{note:string|null;customer_person_id:string}>(`
   SELECT note,customer_person_id::text FROM service_requests WHERE id=$1::uuid
  `,[blankReceipt.id]);
  assert.equal(blankPersisted.rows[0]?.note,null);
  assert.equal(blankPersisted.rows[0]?.customer_person_id,customerPerson);
  const blankRetry=await send('Bearer '+owner.token,blankKey,blankBody);
  assert.equal(blankRetry.status,201);
  assert.deepEqual(await blankRetry.json(),blankReceipt,
   'same explicit-null payload and idempotency key replay one receipt');
  const omittedKey='registered_http_create_20261123_omitted_note';
  const omitted=await send('Bearer '+owner.token,omittedKey,{
   service_offer_id:offer,consent_to_contact:true,
  });
  assert.equal(omitted.status,201,'omitted note is also valid');
  const omittedReceipt=await omitted.json() as {id:string};
  const omittedPersisted=await db.query<{note:string|null}>(`
   SELECT note FROM service_requests WHERE id=$1::uuid
  `,[omittedReceipt.id]);
  assert.equal(omittedPersisted.rows[0]?.note,null);
  const total=await db.query<{n:string}>(`
   SELECT count(*)::text AS n FROM service_requests
   WHERE customer_person_id=$1::uuid AND offer_id=$2::uuid
  `,[customerPerson,offer]);
  assert.equal(total.rows[0]?.n,'3','one original plus two blank-note creations');

  await db.query('UPDATE sessions SET revoked_at=now() WHERE token_hash=$1',[owner.hash]);
  const revoked=await send('Bearer '+owner.token,
   'registered_http_create_20261123_002',body);
  assert.equal(revoked.status,401);
  process.env.SERVICES_ENABLE_REGISTERED_REQUEST_CREATE_HTTP='disabled';
  const off=await send('Bearer '+owner.token,
   'registered_http_create_20261123_003',body);
  assert.equal(off.status,404);
 }finally{
  await app?.close();
  if(previousPepper===undefined)delete process.env.ACCOUNT_SESSION_HMAC_KEY;
  else process.env.ACCOUNT_SESSION_HMAC_KEY=previousPepper;
  if(previousFlag===undefined)delete process.env.SERVICES_ENABLE_REGISTERED_REQUEST_CREATE_HTTP;
  else process.env.SERVICES_ENABLE_REGISTERED_REQUEST_CREATE_HTTP=previousFlag;
  await db.query('ROLLBACK').catch(()=>{});
  await db.end();
 }
});
