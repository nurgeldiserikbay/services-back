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
import {PlatformProfessionalAppealAuditReadController} from '../src/modules/admin/admin-professional-appeal-audit-http.controller.js';
import {PlatformProfessionalAppealAuditReadService} from '../src/modules/admin/admin-professional-appeal-audit-http.service.js';

test('isolated admin appeal HTTP executes scoped reviewer allocation and independent decision with PostgreSQL audit',async()=>{
 if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL required');
 const db=new Client({connectionString:process.env.DATABASE_URL});
 const envKeys=[
  'PLATFORM_ADMIN_SESSION_HMAC_KEY',
  'SERVICES_ENABLE_PLATFORM_APPEAL_ASSIGN_HTTP',
  'SERVICES_ENABLE_PLATFORM_APPEAL_DECIDE_HTTP',
  'SERVICES_ENABLE_PLATFORM_APPEAL_AUDIT_READ_HTTP',
 ] as const;
 const originals=envKeys.map(key=>process.env[key]);
 const pepper=randomBytes(32),assignToken=issueAdminSessionToken(pepper),decideToken=issueAdminSessionToken(pepper);
 const owner=randomUUID(),person=randomUUID(),profession=randomUUID(),profile=randomUUID();
 const initialActor=randomUUID(),assigner=randomUUID(),reviewer=randomUUID();
 const auditor=randomUUID(),auditorUser=randomUUID(),auditorSession=randomUUID();
 const auditorGrant=randomUUID(),auditorToken=issueAdminSessionToken(pepper);
 const assignUser=randomUUID(),reviewUser=randomUUID();
 const rejectionCase=randomUUID(),rejection=randomUUID(),appealCase=randomUUID(),appeal=randomUUID();
 const scope='professional:'+profile;
 const assignBody={profile_id:profile,profile_version:1,reviewer_staff_id:reviewer};
 const decisionBody={profile_id:profile,profile_version:1,outcome:'OVERTURN_REJECTION'};
 let app:Awaited<ReturnType<typeof NestFactory.create>>|undefined;
 let connected=false,tx=false;
 @Module({controllers:[PlatformProfessionalAppealAdminController,PlatformProfessionalAppealAuditReadController],providers:[
  PlatformProfessionalAppealAdminService,PlatformProfessionalAppealAuditReadService,
  {provide:DatabasePool,useValue:{transaction:async<T>(fn:(client:Client)=>Promise<T>)=>fn(db)}},
 ]})class IsolatedModule{}
 try{
  await db.connect();connected=true;
  await db.query('BEGIN');tx=true;
  await db.query('INSERT INTO users(id) VALUES($1),($2),($3),($4)',[owner,assignUser,reviewUser,auditorUser]);
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
  await db.query("INSERT INTO platform_admin_staff(id,user_id,role) VALUES($1,$2,'auditor')",[auditor,auditorUser]);
  await db.query('INSERT INTO platform_admin_grants(id,staff_id,scope) VALUES($1,$2,$3)',[auditorGrant,auditor,scope]);
  await db.query("INSERT INTO platform_admin_totp_factors(staff_id,encrypted_secret,key_version,created_at,activated_at) VALUES($1,'integration-test-placeholder-encrypted-envelope','test-v1',now()-interval '4 minutes',now()-interval '3 minutes')",[auditor]);
  await db.query("INSERT INTO platform_admin_sessions(id,staff_id,token_hash,mfa_verified_at,expires_at) VALUES($1,$2,$3,now()-interval '1 minute',now()+interval '1 hour')",[auditorSession,auditor,auditorToken.tokenHash]);
  process.env.PLATFORM_ADMIN_SESSION_HMAC_KEY=pepper.toString('base64');
  process.env.SERVICES_ENABLE_PLATFORM_APPEAL_ASSIGN_HTTP='disabled';
  process.env.SERVICES_ENABLE_PLATFORM_APPEAL_DECIDE_HTTP='disabled';
  process.env.SERVICES_ENABLE_PLATFORM_APPEAL_AUDIT_READ_HTTP='disabled';
  app=await NestFactory.create(IsolatedModule,{logger:false,abortOnError:false});
  app.setGlobalPrefix('v1');await app.listen(0,'127.0.0.1');
  const endpoint=(await app.getUrl())+'/v1/admin/moderation/appeals/'+appeal;
  const auditBase=(await app.getUrl())+'/v1/admin/moderation/appeals/';
  const audit=(token:string,profileId:string=profile,appealId:string=appeal,headers:Record<string,string>={})=>fetch(
   auditBase+appealId+'/audit?profile_id='+profileId,{
    method:'GET',headers:{Authorization:'Bearer '+token,...headers},redirect:'manual',
   });
  const request=(operation:'assignment'|'decision',token:string,body:unknown)=>fetch(endpoint+'/'+operation,{
   method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
   body:JSON.stringify(body),redirect:'manual',
  });
  assert.equal((await audit(auditorToken.token)).status,401,'audit read defaults off');
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
  // Read-only HTTP path: allow an auditor, deny unrelated scope and live revocations.
  assert.equal((await audit(auditorToken.token)).status,401,'audit still separately disabled');
  process.env.SERVICES_ENABLE_PLATFORM_APPEAL_AUDIT_READ_HTTP='enabled';
  const allowed=await audit(auditorToken.token);
  assert.equal(allowed.status,200);
  assert.match(allowed.headers.get('cache-control')??'',/no-store/);
  assert.equal(allowed.headers.get('x-content-type-options'),'nosniff');
  const receipt=await allowed.json() as {
   appeal_id:string;profile_id:string;profile_version:number;
   events:Array<{event_kind:string;actor_staff_id:string;reviewer_staff_id:string;
    outcome:string|null;occurred_at:string}>;
  };
  assert.equal(receipt.appeal_id,appeal);
  assert.equal(receipt.profile_id,profile);
  assert.equal(receipt.profile_version,1);
  assert.deepEqual(receipt.events.map(event=>({
   kind:event.event_kind,actor:event.actor_staff_id,reviewer:event.reviewer_staff_id,
   outcome:event.outcome,
  })),[
   {kind:'REVIEWER_ASSIGNED',actor:assigner,reviewer,outcome:null},
   {kind:'APPEAL_DECIDED',actor:reviewer,reviewer,outcome:'OVERTURN_REJECTION'},
  ]);
  assert.ok(receipt.events.every(event=>!Number.isNaN(Date.parse(event.occurred_at))));
  assert.deepEqual(Object.keys(receipt).sort(),['appeal_id','events','profile_id','profile_version']);
  assert.ok(receipt.events.every(event=>
   Object.keys(event).sort().join(',')==='actor_staff_id,event_kind,occurred_at,outcome,reviewer_staff_id'));
  assert.equal((await audit(auditorToken.token,randomUUID())).status,401,'different profile');
  assert.equal((await audit(auditorToken.token,profile,randomUUID())).status,401,'absent appeal');
  assert.equal((await audit(auditorToken.token,profile,appeal,{Origin:'https://evil.example'})).status,401);
  assert.equal((await audit(auditorToken.token,profile,appeal,{Cookie:'session=fake'})).status,401);
  assert.equal((await audit(auditorToken.token,profile,appeal,{Authorization:'Bearer invalid'})).status,401);
  await db.query("UPDATE platform_admin_staff SET role='operator' WHERE id=$1",[auditor]);
  assert.equal((await audit(auditorToken.token)).status,401,'operator even with grant');
  await db.query("UPDATE platform_admin_staff SET role='auditor' WHERE id=$1",[auditor]);
  await db.query("UPDATE platform_admin_sessions SET mfa_verified_at=now()-interval '16 minutes' WHERE id=$1",[auditorSession]);
  assert.equal((await audit(auditorToken.token)).status,401,'stale MFA');
  await db.query("UPDATE platform_admin_sessions SET mfa_verified_at=now()-interval '1 minute' WHERE id=$1",[auditorSession]);
  await db.query("UPDATE platform_admin_sessions SET revoked_at=now() WHERE id=$1",[auditorSession]);
  assert.equal((await audit(auditorToken.token)).status,401,'revoked token');
  await db.query("UPDATE platform_admin_sessions SET revoked_at=NULL WHERE id=$1",[auditorSession]);
  await db.query('DELETE FROM platform_admin_grants WHERE id=$1',[auditorGrant]);
  assert.equal((await audit(auditorToken.token)).status,401,'withdrawn scope');
  await db.query('INSERT INTO platform_admin_grants(id,staff_id,scope) VALUES($1,$2,$3)',[auditorGrant,auditor,scope]);
  assert.equal((await audit(auditorToken.token)).status,200,'read restored only with live grant');

 }finally{
  await app?.close();
  for(let i=0;i<envKeys.length;i++){
   if(originals[i]===undefined)delete process.env[envKeys[i]];
   else process.env[envKeys[i]]=originals[i];
  }
  if(connected){if(tx)await db.query('ROLLBACK').catch(()=>{});await db.end();}
 }
});
