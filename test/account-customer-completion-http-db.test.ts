import 'reflect-metadata';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomBytes,randomUUID} from 'node:crypto';
import {BadRequestException,Module,UnauthorizedException} from '@nestjs/common';
import {NestFactory} from '@nestjs/core';
import {Client} from 'pg';
import {AccountCustomerCompletionController} from
 '../src/modules/identity/account-customer-completion.controller.js';
import {AccountBearerSessionService} from
 '../src/modules/identity/account-bearer-session.service.js';
import {issueSessionToken} from '../src/modules/identity/session-proof.js';

test('completion HTTP boundary denies invalid bearer, weak version and nonempty payload',async()=>{
 let mutations=0;
 const mock={completeOwnRequest:async(token:string,id:string,version:number)=>{
  mutations++;
  assert.equal(token,'a'.repeat(43));
  assert.equal(id,'11111111-1111-4111-8111-111111111111');
  assert.equal(version,1);
  return {id,state:'completed',version:2};
 }};
 const controller=new AccountCustomerCompletionController(mock as never);
 const id='11111111-1111-4111-8111-111111111111';
 for(const invalid of [undefined,'Basic abc','Bearer bad']){
  await assert.rejects(controller.complete(invalid,id,'"1"',{}),UnauthorizedException);
 }
 for(const invalid of [undefined,'1','W/"1"','"0"','*','"99999999999"']){
  await assert.rejects(controller.complete('Bearer '+'a'.repeat(43),id,invalid,{}),BadRequestException);
 }
 for(const invalid of [undefined,null,[],{note:'not allowed'},'{}']){
  await assert.rejects(controller.complete('Bearer '+'a'.repeat(43),id,'"1"',invalid),BadRequestException);
 }
 assert.equal(mutations,0,'denials must occur before entering transaction');
 assert.deepEqual(await controller.complete('Bearer '+'a'.repeat(43),id,'"1"',{}),
  {id,state:'completed',version:2});
 assert.equal(mutations,1);
});

test('real Nest HTTP and PostgreSQL complete only for active owning bearer',async()=>{
 if(!process.env.DATABASE_URL)throw Error('DATABASE_URL required');
 const db=new Client({connectionString:process.env.DATABASE_URL});
 await db.connect();await db.query('BEGIN');
 const previous=process.env.ACCOUNT_SESSION_HMAC_KEY;
 const pepper=randomBytes(32);
 process.env.ACCOUNT_SESSION_HMAC_KEY=pepper.toString('base64');
 const owner=issueSessionToken(pepper),foreign=issueSessionToken(pepper);
 const ownerUser=randomUUID(),foreignUser=randomUUID(),sellerUser=randomUUID();
 const ownerPerson=randomUUID(),foreignPerson=randomUUID(),sellerPerson=randomUUID();
 const org=randomUUID(),definition=randomUUID(),offer=randomUUID(),request=randomUUID();
 let app:Awaited<ReturnType<typeof NestFactory.create>>|undefined;
 try{
  await db.query('INSERT INTO users(id) VALUES($1),($2),($3)',
   [ownerUser,foreignUser,sellerUser]);
  await db.query('INSERT INTO persons(id,user_id) VALUES($1,$2),($3,$4),($5,$6)',
   [ownerPerson,ownerUser,foreignPerson,foreignUser,sellerPerson,sellerUser]);
  await db.query(`INSERT INTO sessions(id,user_id,token_hash,family_id,expires_at)
   VALUES($1,$2,$3,$4,now()+interval '1 day'),
         ($5,$6,$7,$8,now()+interval '1 day')`,
   [randomUUID(),ownerUser,owner.hash,randomUUID(),
    randomUUID(),foreignUser,foreign.hash,randomUUID()]);
  await db.query(`INSERT INTO organizations
   (id,owner_person_id,slug,name,status)
   VALUES($1,$2,$3,'Completion HTTP seller','ACTIVE')`,
   [org,sellerPerson,'completion-http-'+randomUUID()]);
  await db.query(`INSERT INTO service_definitions(id,code,name)
   VALUES($1,$2,'Completion HTTP service')`,
   [definition,'completion-http-'+randomUUID()]);
  await db.query(`INSERT INTO service_offers
   (id,definition_id,organization_id,title,status,delivery_mode,contacts)
   VALUES($1,$2,$3,'Completion HTTP offer','PUBLISHED','online','{}'::jsonb)`,
   [offer,definition,org]);
  await db.query(`INSERT INTO service_requests
   (id,offer_id,customer_person_id,source_context,seller_organization_id,
    status,accepted_at)
   VALUES($1,$2,$3,'ORGANIZATION',$4,'ACCEPTED',now())`,
   [request,offer,ownerPerson,org]);
  const service=new AccountBearerSessionService({
   transaction:async<T>(work:(client:Client)=>Promise<T>)=>work(db),
  } as never);
  @Module({controllers:[AccountCustomerCompletionController],
   providers:[{provide:AccountBearerSessionService,useValue:service}]})
  class IsolatedCompletionModule{}
  app=await NestFactory.create(IsolatedCompletionModule,{logger:false});
  app.setGlobalPrefix('v1');
  await app.listen(0,'127.0.0.1');
  const url=(await app.getUrl())+'/v1/account/requests/'+request+'/complete';
  const send=(token:string,match:string,body='{}')=>fetch(url,{
   method:'POST',headers:{Authorization:'Bearer '+token,
    'If-Match':match,'Content-Type':'application/json'},body,redirect:'manual',
  });

  const stranger=await send(foreign.token,'"1"');
  assert.equal(stranger.status,404,'do not reveal other customer request');
  const invalid=await send(owner.token,'W/"1"');
  assert.equal(invalid.status,400);
  const malformed=await send(owner.token,'"1"','{"note":"malicious"}');
  assert.equal(malformed.status,400);
  assert.equal((await db.query<{status:string}>(`
   SELECT status::text FROM service_requests WHERE id=$1`,[request])).rows[0]?.status,'ACCEPTED');

  const completed=await send(owner.token,'"1"');
  assert.equal(completed.status,200);
  assert.deepEqual(await completed.json(),{id:request,state:'completed',version:2});
  assert.match(completed.headers.get('cache-control')??'',/no-store/);
  assert.equal((await db.query<{status:string;version:number}>(`
   SELECT status::text,version FROM service_requests WHERE id=$1`,[request])).rows[0]?.status,'COMPLETED');
  assert.equal((await db.query<{n:string}>(`
   SELECT count(*)::text n FROM service_experiences WHERE request_id=$1`,[request])).rows[0]?.n,'1');
  const replay=await send(owner.token,'"1"');
  assert.equal(replay.status,409);
  assert.equal((await db.query<{n:string}>(`
   SELECT count(*)::text n FROM domain_outbox_events
   WHERE subject_id=$1 AND topic='service_request.completed'`,[request])).rows[0]?.n,'1');

  await db.query('UPDATE sessions SET revoked_at=now() WHERE token_hash=$1',[owner.hash]);
  const revoked=await send(owner.token,'"2"');
  assert.equal(revoked.status,401,'revoked bearer denied before request lookup');
 }finally{
  await app?.close();
  if(previous===undefined)delete process.env.ACCOUNT_SESSION_HMAC_KEY;
  else process.env.ACCOUNT_SESSION_HMAC_KEY=previous;
  await db.query('ROLLBACK').catch(()=>{});
  await db.end();
 }
});
