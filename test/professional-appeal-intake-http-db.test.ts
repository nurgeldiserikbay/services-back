import 'reflect-metadata';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomBytes,randomUUID} from 'node:crypto';
import {Client} from 'pg';
import {Module} from '@nestjs/common';
import {NestFactory} from '@nestjs/core';
import {AccountProfessionalProfilesController} from '../src/modules/identity/account-professional-profiles.controller.js';
import {AccountBearerSessionService} from '../src/modules/identity/account-bearer-session.service.js';
import {issueSessionToken} from '../src/modules/identity/session-proof.js';
import {DatabasePool} from '../src/platform/database/database.pool.js';
import {parseProfileAppeal} from '../src/modules/identity/request-professional-profile-appeal.js';

test('appeal intake binds the owner, REJECT, exact version and immutable case in PostgreSQL HTTP',async()=>{
 const db=new Client({connectionString:process.env.DATABASE_URL});
 const pepper=randomBytes(32),owner=randomUUID(),person=randomUUID(),profession=randomUUID();
 const profile=randomUUID(),moderator=randomUUID(),moderatorUser=randomUUID(),sourceCase=randomUUID();
 const decision=randomUUID(),other=randomUUID(),otherPerson=randomUUID();
 const own=issueSessionToken(pepper),foreign=issueSessionToken(pepper);
 const oldKey=process.env.ACCOUNT_SESSION_HMAC_KEY,oldFlag=process.env.SERVICES_ENABLE_PROFILE_APPEALS;
 let app:Awaited<ReturnType<typeof NestFactory.create>>|undefined;
 process.env.ACCOUNT_SESSION_HMAC_KEY=pepper.toString('base64');
 try{
  await db.connect();await db.query('BEGIN');
  await db.query('INSERT INTO users(id) VALUES($1),($2),($3)',[owner,other,moderatorUser]);
  await db.query('INSERT INTO persons(id,user_id) VALUES($1,$2),($3,$4)',[person,owner,otherPerson,other]);
  await db.query('INSERT INTO professions(id,code,name) VALUES($1,$2,$2)',[profession,profession]);
  await db.query("INSERT INTO professional_profiles(id,person_id,profession_id,slug,status) VALUES($1,$2,$3,$4,'DRAFT')",
   [profile,person,profession,profile]);
  await db.query("INSERT INTO platform_admin_staff(id,user_id,role) VALUES($1,$2,'admin')",[moderator,moderatorUser]);
  await db.query(
   "INSERT INTO platform_moderation_cases(id,resource_scope,subject_kind,state) VALUES($1,$2,'professional','closed')",
   [sourceCase,'professional:'+profile]);
  await db.query(
   "INSERT INTO professional_moderation_decisions(id,case_id,profile_id,profile_version,actor_staff_id,decision) VALUES($1,$2,$3,1,$4,'REJECT')",
   [decision,sourceCase,profile,moderator]);
  await db.query(
   "INSERT INTO sessions(id,user_id,token_hash,family_id,expires_at) VALUES($1,$2,$3,$4,now()+interval '1 day'),($5,$6,$7,$8,now()+interval '1 day')",
   [randomUUID(),owner,own.hash,randomUUID(),randomUUID(),other,foreign.hash,randomUUID()]);
  const pool={transaction:async<T>(work:(client:Client)=>Promise<T>)=>work(db)};
  @Module({controllers:[AccountProfessionalProfilesController],
   providers:[AccountBearerSessionService,{provide:DatabasePool,useValue:pool}]})
  class FixtureModule{}
  app=await NestFactory.create(FixtureModule,{logger:false,abortOnError:false});
  app.setGlobalPrefix('v1');await app.listen(0,'127.0.0.1');
  const endpoint=(await app.getUrl())+'/v1/me/professional-profiles/'+profile+'/appeals';
  const request=(token:string,match:string,body:unknown={decision_id:decision})=>fetch(endpoint,{
   method:'POST',headers:{Authorization:'Bearer '+token,'If-Match':match,'Content-Type':'application/json'},
   body:JSON.stringify(body),
  });
  assert.equal((await request(own.token,'"1"')).status,404,'default-off');
  process.env.SERVICES_ENABLE_PROFILE_APPEALS='enabled';
  assert.equal((await request('invalid','"1"')).status,401);
  assert.equal((await request(foreign.token,'"1"')).status,404,'not-owner');
  assert.equal((await request(own.token,'"2"')).status,409,'stale version');
  assert.equal((await request(own.token,'"1"',{decision_id:randomUUID()})).status,409);
  assert.equal((await request(own.token,'"1"',{decision_id:decision,extra:true})).status,400);
  assert.equal((await request(own.token,'W/"1"')).status,400);
  assert.deepEqual(parseProfileAppeal(profile,'"1"',{decision_id:decision}),
   {id:profile,version:1,decisionId:decision});
  assert.equal((await db.query('SELECT count(*)::int AS total FROM professional_moderation_appeals')).rows[0].total,0);
  const first=await request(own.token,'"1"');
  assert.equal(first.status,201);
  const result=await first.json() as {case_id:string;profile_id:string;profile_version:number;state:string};
  assert.equal(result.profile_id,profile);
  assert.equal(result.profile_version,1);
  assert.equal(result.state,'appeal');
  assert.equal((await request(own.token,'"1"')).status,201,'exact repeat returns same case');
  const records=(await db.query('SELECT original_decision_id::text AS decision,case_id::text AS case_id,profile_id::text AS profile,submitted_by_person_id::text AS owner FROM professional_moderation_appeals WHERE original_decision_id=$1',[decision])).rows;
  assert.deepEqual(records,[{decision,case_id:result.case_id,profile,owner:person}]);
  assert.equal((await db.query('SELECT state FROM platform_moderation_cases WHERE id=$1',[sourceCase])).rows[0].state,'closed');
  assert.equal((await db.query('SELECT state FROM platform_moderation_cases WHERE id=$1',[result.case_id])).rows[0].state,'appeal');
  // Replayed intake must not claim an appeal is still open once triage moves
  // its linked case into a distinct review state. No second case is created.
  await db.query("UPDATE platform_moderation_cases SET state='decision' WHERE id=$1",[result.case_id]);
  assert.equal((await request(own.token,'"1"')).status,409,'advanced appeal is not intake-idempotent');
  assert.equal((await db.query('SELECT count(*)::int AS total FROM professional_moderation_appeals WHERE original_decision_id=$1',[decision])).rows[0].total,1);
  assert.equal((await db.query('SELECT state FROM platform_moderation_cases WHERE id=$1',[result.case_id])).rows[0].state,'decision');
  await db.query('SAVEPOINT deny');
  await assert.rejects(db.query('DELETE FROM professional_moderation_appeals WHERE case_id=$1',[result.case_id]),
   (e:unknown)=>(e as {code?:string}).code==='23514');
  await db.query('ROLLBACK TO SAVEPOINT deny');await db.query('RELEASE SAVEPOINT deny');
  assert.equal((await db.query('SELECT decision FROM professional_moderation_decisions WHERE id=$1',[decision])).rows[0].decision,'REJECT');
 }finally{
  try{await app?.close();}finally{
   if(oldKey===undefined)delete process.env.ACCOUNT_SESSION_HMAC_KEY;
   else process.env.ACCOUNT_SESSION_HMAC_KEY=oldKey;
   if(oldFlag===undefined)delete process.env.SERVICES_ENABLE_PROFILE_APPEALS;
   else process.env.SERVICES_ENABLE_PROFILE_APPEALS=oldFlag;
   await db.query('ROLLBACK').catch(()=>{});await db.end();
  }
 }
});
