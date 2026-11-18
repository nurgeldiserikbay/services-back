import 'reflect-metadata';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomBytes,randomUUID} from 'node:crypto';
import {Module} from '@nestjs/common';
import {NestFactory} from '@nestjs/core';
import {Client} from 'pg';
import {DatabasePool} from '../src/platform/database/database.pool.js';
import {issueAdminSessionToken} from '../src/modules/admin/admin-session-token.js';
import {PlatformProfessionalAppealAdminController} from '../src/modules/admin/admin-professional-appeal-http.controller.js';
import {PlatformProfessionalAppealAdminService} from '../src/modules/admin/admin-professional-appeal-http.service.js';

test('isolated admin appeal HTTP executes scoped reviewer allocation and independent decision with PostgreSQL audit',async()=>{
 if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL required');
 const db=new Client({connectionString:process.env.DATABASE_URL});
 const envKeys=[
  'PLATFORM_ADMIN_SESSION_HMAC_KEY',
  'SERVICES_ENABLE_PLATFORM_APPEAL_ASSIGN_HTTP',
  'SERVICES_ENABLE_PLATFORM_APPEAL_DECIDE_HTTP',
 ] as const;
 const originals=envKeys.map(key=>process.env[key]);
 const pepper=randomBytes(32),assignToken=issueAdminSessionToken(pepper),decideToken=issueAdminSessionToken(pepper);
 const owner=randomUUID(),person=randomUUID(),profession=randomUUID(),profile=randomUUID();
 const initialActor=randomUUID(),assigner=randomUUID(),reviewer=randomUUID();
 const assignUser=randomUUID(),reviewUser=randomUUID();
 const rejectionCase=randomUUID(),rejection=randomUUID(),appealCase=randomUUID(),appeal=randomUUID();
 const scope='professional:'+profile;
 const assignBody={profile_id:profile,profile_version:1,reviewer_staff_id:reviewer};
 const decisionBody={profile_id:profile,profile_version:1,outcome:'OVERTURN_REJECTION'};
 let app:Awaited<ReturnType<typeof NestFactory.create>>|undefined;
 let connected=false,tx=false;
 @Module({controllers:[PlatformProfessionalAppealAdminController],providers:[
  PlatformProfessionalAppealAdminService,
  {provide:DatabasePool,useValue:{transaction:async<T>(fn:(client:Client)=>Promise<T>)=>fn(db)}},
 ]})class IsolatedModule{}
 try{
  await db.connect();connected=true;
  await db.query('BEGIN');tx=true;
  await db.query('INSERT INTO users(id) VALUES($1),($2),($3)',[owner,assignUser,reviewUser]);
  await db.query('INSERT INTO persons(id,user_id) VALUES($1,$2)',[person,owner]);
  await db.query('INSERT INTO professions(id,code,name) VALUES($1,$2,$2)',[profession,profession]);
  await db.query("INSERT INTO professional_profiles(id,person_id,profession_id,slug,status) VALUES($1,$2,$3,$4,'DRAFT')",
   [profile,person,profession,profile]);
  for(const [staff,user] of [[initialActor,owner],[assigner,assignUser],[reviewer,reviewUser]])
   await db.query("INSERT INTO platform_admin_staff(id,user_id,role) VALUES($1,$2,'admin')",[staff,user]);
  await db.query("INSERT INTO platform_moderation_cases(id,resource_scope,subject_kind,state) VALUES($1,$2,'professional','closed')",
   [rejectionCase,scope]);
  await db.query("INSERT INTO professional_moderation_decisions(id,case_id,profile_id,profile_version,actor_staff_id,decision) VALUES($1,$2,$3,1,$4,'REJECT')",
   [rejection,rejectionCase,profile,initialActor]);
  await db.query("INSERT INTO platform_moderation_cases(id,resource_scope,subject_kind,state) VALUES($1,$2,'professional','appeal')",
   [appealCase,scope]);
  await db.query('INSERT INTO professional_moderation_appeals(id,original_decision_id,case_id,profile_id,profile_version,submitted_by_person_id) VALUES($1,$2,$3,$4,1,$5)',
   [appeal,rejection,appealCase,profile,person]);
  for(const [staff,token] of [[assigner,assignToken],[reviewer,decideToken]] as const){
   await db.query('INSERT INTO platform_admin_grants(id,staff_id,scope) VALUES($1,$2,$3)',[randomUUID(),staff,scope]);
   await db.query("INSERT INTO platform_admin_totp_factors(staff_id,encrypted_secret,key_version,created_at,activated_at) VALUES($1,'integration-test-placeholder-encrypted-envelope','test-v1',now()-interval '4 minutes',now()-interval '3 minutes')",[staff]);
   await db.query("INSERT INTO platform_admin_sessions(id,staff_id,token_hash,mfa_verified_at,expires_at) VALUES($1,$2,$3,now()-interval '1 minute',now()+interval '1 hour')",
    [randomUUID(),staff,token.tokenHash]);
  }
  process.env.PLATFORM_ADMIN_SESSION_HMAC_KEY=pepper.toString('base64');
  process.env.SERVICES_ENABLE_PLATFORM_APPEAL_ASSIGN_HTTP='disabled';
  process.env.SERVICES_ENABLE_PLATFORM_APPEAL_DECIDE_HTTP='disabled';
  app=await NestFactory.create(IsolatedModule,{logger:false,abortOnError:false});
  app.setGlobalPrefix('v1');await app.listen(0,'127.0.0.1');
  const endpoint=(await app.getUrl())+'/v1/admin/moderation/appeals/'+appeal;
  const request=(operation:'assignment'|'decision',token:string,body:unknown)=>fetch(endpoint+'/'+operation,{
   method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
   body:JSON.stringify(body),redirect:'manual',
  });
  assert.equal((await request('assignment',assignToken.token,assignBody)).status,401,'assignment off by default');
  assert.equal((await request('decision',decideToken.token,decisionBody)).status,401,'decision off by default');
  process.env.SERVICES_ENABLE_PLATFORM_APPEAL_ASSIGN_HTTP='enabled';
  // The unrelated decision flag remains off, even for a valid reviewer.
  assert.equal((await request('decision',decideToken.token,decisionBody)).status,401);
  assert.equal((await request('assignment',decideToken.token,assignBody)).status,409,
   'assignee cannot appoint self');
  assert.equal((await request('assignment',assignToken.token,{...assignBody,profile_version:2})).status,409);
  const assigned=await request('assignment',assignToken.token,assignBody);
  assert.equal(assigned.status,200);
  assert.deepEqual(await assigned.json(),{appeal_id:appeal,reviewer_staff_id:reviewer,assigned_by_staff_id:assigner});
  assert.equal((await request('assignment',assignToken.token,assignBody)).status,200,'replay allocation');
  assert.equal((await request('decision',decideToken.token,decisionBody)).status,401,'decision still off');
  process.env.SERVICES_ENABLE_PLATFORM_APPEAL_DECIDE_HTTP='enabled';
  assert.equal((await request('decision',assignToken.token,decisionBody)).status,409,
   'assigner cannot adjudicate');
  assert.equal((await request('decision',decideToken.token,decisionBody)).status,409,
   'case is not yet decision-ready');
  await db.query("UPDATE platform_moderation_cases SET state='decision' WHERE id=$1",[appealCase]);
  assert.equal((await request('decision',assignToken.token,decisionBody)).status,409);
  const decided=await request('decision',decideToken.token,decisionBody);
  assert.equal(decided.status,200);
  assert.deepEqual(await decided.json(),{appeal_id:appeal,profile_id:profile,profile_version:1,outcome:'OVERTURN_REJECTION'});
  assert.equal((await request('decision',decideToken.token,decisionBody)).status,200,'exact outcome replay');
  assert.equal((await request('decision',decideToken.token,{...decisionBody,outcome:'UPHOLD_REJECTION'})).status,409);
  const events=(await db.query(
   'SELECT event_kind,actor_staff_id::text AS actor,reviewer_staff_id::text AS reviewer,outcome FROM professional_appeal_audit_events WHERE appeal_id=$1 ORDER BY event_kind',
   [appeal])).rows;
  assert.deepEqual(events,[
   {event_kind:'APPEAL_DECIDED',actor:reviewer,reviewer,outcome:'OVERTURN_REJECTION'},
   {event_kind:'REVIEWER_ASSIGNED',actor:assigner,reviewer,outcome:null},
  ]);
  assert.equal((await db.query('SELECT status FROM professional_profiles WHERE id=$1',[profile])).rows[0].status,'DRAFT');
  assert.equal((await db.query('SELECT state FROM platform_moderation_cases WHERE id=$1',[appealCase])).rows[0].state,'closed');
  assert.equal((await db.query('SELECT count(*)::int AS total FROM professional_moderation_appeal_decisions WHERE appeal_id=$1',[appeal])).rows[0].total,1);
 }finally{
  await app?.close();
  for(let i=0;i<envKeys.length;i++){
   if(originals[i]===undefined)delete process.env[envKeys[i]];
   else process.env[envKeys[i]]=originals[i];
  }
  if(connected){if(tx)await db.query('ROLLBACK').catch(()=>{});await db.end();}
 }
});
