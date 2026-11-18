import 'reflect-metadata';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {Client} from 'pg';
import {Module} from '@nestjs/common';
import {NestFactory} from '@nestjs/core';
import {AccountProfessionalProfilesController} from '../src/modules/identity/account-professional-profiles.controller.js';
import {AccountBearerSessionService} from '../src/modules/identity/account-bearer-session.service.js';
import {issueSessionToken} from '../src/modules/identity/session-proof.js';
import {DatabasePool} from '../src/platform/database/database.pool.js';

test('publication HTTP creates immutable revisions and audit only after readiness checks',async()=>{
 const db=new Client({connectionString:process.env.DATABASE_URL});
 const pepper=randomBytes(32),owner=randomUUID(),person=randomUUID(),profession=randomUUID(),service=randomUUID();
 const id=randomUUID(),offer=randomUUID(),outsider=randomUUID(),outsiderPerson=randomUUID();
 const own=issueSessionToken(pepper),foreign=issueSessionToken(pepper);
 const oldKey=process.env.ACCOUNT_SESSION_HMAC_KEY,oldFlag=process.env.SERVICES_ENABLE_PROFILE_PUBLISH;
 let app:Awaited<ReturnType<typeof NestFactory.create>>|undefined;
 process.env.ACCOUNT_SESSION_HMAC_KEY=pepper.toString('base64');
 try{
  await db.connect();await db.query('BEGIN');
  await db.query('INSERT INTO users(id) VALUES($1),($2)',[owner,outsider]);
  await db.query('INSERT INTO persons(id,user_id) VALUES($1,$2),($3,$4)',[person,owner,outsiderPerson,outsider]);
  await db.query('INSERT INTO professions(id,code,name) VALUES($1,$2,$2)',[profession,profession]);
  await db.query('INSERT INTO service_definitions(id,code,name) VALUES($1,$2,$2)',[service,service]);
  await db.query("INSERT INTO professional_profiles(id,person_id,profession_id,slug,status,title,about) VALUES($1,$2,$3,$4,'DRAFT','Electrician','Experienced specialist for electrical maintenance')",[id,person,profession,id]);
  await db.query("INSERT INTO sessions(id,user_id,token_hash,family_id,expires_at) VALUES($1,$2,$3,$4,now()+interval '1 day'),($5,$6,$7,$8,now()+interval '1 day')",
   [randomUUID(),owner,own.hash,randomUUID(),randomUUID(),outsider,foreign.hash,randomUUID()]);
  const pool={transaction:async<T>(work:(client:Client)=>Promise<T>)=>work(db)};
  @Module({controllers:[AccountProfessionalProfilesController],providers:[AccountBearerSessionService,{provide:DatabasePool,useValue:pool}]})
  class FixtureModule{}
  app=await NestFactory.create(FixtureModule,{logger:false,abortOnError:false});
  app.setGlobalPrefix('v1');await app.listen(0,'127.0.0.1');
  const endpoint=(await app.getUrl())+'/v1/me/professional-profiles/'+id+'/publish';
  const publish=(token:string,match:string,body:unknown={})=>fetch(endpoint,{method:'POST',headers:{Authorization:'Bearer '+token,'If-Match':match,'Content-Type':'application/json'},body:JSON.stringify(body)});
  assert.equal((await publish(own.token,'"1"')).status,404,'default-off flag must close publication');
  process.env.SERVICES_ENABLE_PROFILE_PUBLISH='enabled';
  assert.equal((await publish('invalid','"1"')).status,401);
  assert.equal((await publish(foreign.token,'"1"')).status,404,'foreign owner and missing ID indistinguishable');
  assert.equal((await publish(own.token,'W/"1"')).status,400);
  assert.equal((await publish(own.token,'"1"',{force:true})).status,400);
  assert.equal((await publish(own.token,'"1"')).status,409,'offer is mandatory');
  assert.equal((await db.query('SELECT count(*)::int AS total FROM professional_publication_audit WHERE profile_id=$1',[id])).rows[0].total,0);
  await db.query("INSERT INTO service_offers(id,definition_id,professional_id,title,status,delivery_mode,contacts) VALUES($1,$2,$3,'Electrical repairs','PUBLISHED','online','{}'::jsonb)",[offer,service,id]);
  // Simulate audit insert failure after snapshot UPDATE; rollback must restore
  // profile state and must not leave an immutable published revision.
  await db.query('SAVEPOINT injected_publication_audit');
  await db.query(
   "INSERT INTO professional_publication_audit(profile_id,actor_person_id,from_status,from_version,to_version) VALUES($1,$2,'DRAFT',1,2)",
   [id,person]);
  await db.query('SAVEPOINT attempted_publication');
  assert.equal((await publish(own.token,'"1"')).status,500,'duplicate audit record must abort the transaction');
  await db.query('ROLLBACK TO SAVEPOINT attempted_publication');
  const notCommitted=(await db.query('SELECT status,version,published_version FROM professional_profiles WHERE id=$1',[id])).rows[0];
  assert.deepEqual(notCommitted,{status:'DRAFT',version:1,published_version:null});
  assert.equal((await db.query('SELECT count(*)::int AS total FROM professional_published_revisions WHERE profile_id=$1',[id])).rows[0].total,0);
  await db.query('ROLLBACK TO SAVEPOINT injected_publication_audit');
  await db.query('RELEASE SAVEPOINT injected_publication_audit');
  assert.equal((await publish(own.token,'"2"')).status,409,'stale version must fail');
  const moderationId=randomUUID();
  await db.query("INSERT INTO platform_moderation_cases(id,resource_scope,subject_kind,state) VALUES($1,$2,'professional','triage')",[moderationId,'professional:'+id]);
  assert.equal((await publish(own.token,'"1"')).status,409,'unresolved moderation blocks publication');
  assert.equal((await db.query('SELECT count(*)::int AS total FROM professional_publication_audit WHERE profile_id=$1',[id])).rows[0].total,0);
  await db.query("UPDATE platform_moderation_cases SET state='closed' WHERE id=$1",[moderationId]);
  const assignmentId=randomUUID();
  await db.query("INSERT INTO service_assignments(id,offer_id,professional_id,status) VALUES($1,$2,$3,'PROPOSED')",[assignmentId,offer,id]);
  assert.equal((await publish(own.token,'"1"')).status,409,'proposed service assignment blocks publish');
  assert.equal((await db.query('SELECT count(*)::int AS total FROM professional_publication_audit WHERE profile_id=$1',[id])).rows[0].total,0);
  await db.query("UPDATE service_assignments SET status='REVOKED' WHERE id=$1",[assignmentId]);
  const first=await publish(own.token,'"1"');
  assert.equal(first.status,201);
  assert.match(first.headers.get('cache-control')??'',/no-store/);
  assert.deepEqual(await first.json(),{id,lifecycle_status:'published',version:2,published_version:2});
  assert.equal((await publish(own.token,'"1"')).status,409);
  assert.equal((await publish(own.token,'"2"')).status,409,'unchanged published version cannot republish');
  const edit=await fetch((await app.getUrl())+'/v1/me/professional-profiles/'+id,{method:'PATCH',
   headers:{Authorization:'Bearer '+own.token,'If-Match':'"2"','Content-Type':'application/json'},
   body:JSON.stringify({title:'Updated electrician'})});
  assert.equal(edit.status,200);
  const next=await publish(own.token,'"3"');
  assert.equal(next.status,201);assert.deepEqual(await next.json(),{id,lifecycle_status:'published',version:4,published_version:4});
  const history=(await db.query('SELECT version,title,about FROM professional_published_revisions WHERE profile_id=$1 ORDER BY version',[id])).rows;
  assert.deepEqual(history.map(({version,title}:{version:number;title:string})=>({version,title})),[
   {version:2,title:'Electrician'},{version:4,title:'Updated electrician'},
  ]);
  const audit=(await db.query('SELECT actor_person_id::text,from_status,from_version,to_version FROM professional_publication_audit WHERE profile_id=$1 ORDER BY to_version',[id])).rows;
  assert.deepEqual(audit,[{actor_person_id:person,from_status:'DRAFT',from_version:1,to_version:2},
   {actor_person_id:person,from_status:'PUBLISHED',from_version:3,to_version:4}]);
 }finally{
  try{await app?.close();}finally{
   if(oldKey===undefined)delete process.env.ACCOUNT_SESSION_HMAC_KEY;
   else process.env.ACCOUNT_SESSION_HMAC_KEY=oldKey;
   if(oldFlag===undefined)delete process.env.SERVICES_ENABLE_PROFILE_PUBLISH;
   else process.env.SERVICES_ENABLE_PROFILE_PUBLISH=oldFlag;
   await db.query('ROLLBACK').catch(()=>{});await db.end();
  }
 }
});
