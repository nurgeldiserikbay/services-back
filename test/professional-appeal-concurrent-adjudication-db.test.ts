import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomBytes,randomUUID} from 'node:crypto';
import {Client} from 'pg';
import {ConflictException} from '@nestjs/common';
import {issueAdminSessionToken} from '../src/modules/admin/admin-session-token.js';
import {decideProfessionalAppeal} from '../src/modules/admin/admin-professional-appeal-decision.js';

const connect=()=>new Client({connectionString:process.env.DATABASE_URL});

test('two committed PostgreSQL clients serialize an appeal decision and exact replay',async()=>{
 if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL required');
 const setup=connect(),first=connect(),second=connect(),observer=connect();
 const pepper=randomBytes(32),token=issueAdminSessionToken(pepper);
 const ownerUser=randomUUID(),person=randomUUID(),profession=randomUUID(),profile=randomUUID();
 const reviewerUser=randomUUID(),assignerUser=randomUUID();
 const originalActor=randomUUID(),reviewer=randomUUID(),assigner=randomUUID();
 const originalCase=randomUUID(),rejection=randomUUID(),appealCase=randomUUID(),appeal=randomUUID();
 const body={profile_id:profile,profile_version:1,outcome:'OVERTURN_REJECTION'};
 let setupTx=false,firstTx=false,secondTx=false;
 await Promise.all([setup.connect(),first.connect(),second.connect(),observer.connect()]);
 try{
  const database=(await setup.query<{name:string}>('SELECT current_database() AS name')).rows[0]?.name;
  assert.equal(database,'services_test','Committed concurrency fixture requires disposable CI database');
  await setup.query('BEGIN');setupTx=true;
  await setup.query('INSERT INTO users(id) VALUES($1)',[ownerUser]);
  await setup.query('INSERT INTO persons(id,user_id) VALUES($1,$2)',[person,ownerUser]);
  await setup.query('INSERT INTO professions(id,code,name) VALUES($1,$2,$2)',[profession,profession]);
  await setup.query("INSERT INTO professional_profiles(id,person_id,profession_id,slug,status) VALUES($1,$2,$3,$4,'DRAFT')",
   [profile,person,profession,profile]);
  await setup.query("INSERT INTO platform_admin_staff(id,user_id,role) VALUES($1,$2,'admin')",[originalActor,ownerUser]);
  await setup.query('INSERT INTO users(id) VALUES($1)',[reviewerUser]);
  await setup.query('INSERT INTO users(id) VALUES($1)',[assignerUser]);
  await setup.query("INSERT INTO platform_admin_staff(id,user_id,role) VALUES($1,$2,'admin')",[reviewer,reviewerUser]);
  await setup.query("INSERT INTO platform_admin_staff(id,user_id,role) VALUES($1,$2,'admin')",[assigner,assignerUser]);
  await setup.query('INSERT INTO platform_admin_grants(id,staff_id,scope) VALUES($1,$2,$3)',
   [randomUUID(),reviewer,'professional:'+profile]);
  await setup.query("INSERT INTO platform_admin_sessions(id,staff_id,token_hash,mfa_verified_at,expires_at) VALUES($1,$2,$3,now()-interval '1 minute',now()+interval '1 hour')",
   [randomUUID(),reviewer,token.tokenHash]);
  await setup.query("INSERT INTO platform_admin_totp_factors(staff_id,encrypted_secret,key_version,created_at,activated_at) VALUES($1,'integration-test-placeholder-encrypted-envelope','test-v1',now()-interval '4 minutes',now()-interval '3 minutes')",[reviewer]);
  await setup.query("INSERT INTO platform_moderation_cases(id,resource_scope,subject_kind,state) VALUES($1,$2,'professional','closed')",
   [originalCase,'professional:'+profile]);
  await setup.query("INSERT INTO professional_moderation_decisions(id,case_id,profile_id,profile_version,actor_staff_id,decision) VALUES($1,$2,$3,1,$4,'REJECT')",
   [rejection,originalCase,profile,originalActor]);
  await setup.query("INSERT INTO platform_moderation_cases(id,resource_scope,subject_kind,state) VALUES($1,$2,'professional','appeal')",
   [appealCase,'professional:'+profile]);
  await setup.query("INSERT INTO professional_moderation_appeals(id,original_decision_id,case_id,profile_id,profile_version,submitted_by_person_id) VALUES($1,$2,$3,$4,1,$5)",
   [appeal,rejection,appealCase,profile,person]);
  await setup.query('INSERT INTO professional_appeal_review_assignments(appeal_id,reviewer_staff_id,assigned_by_staff_id) VALUES($1,$2,$3)',
   [appeal,reviewer,assigner]);
  await setup.query("UPDATE platform_moderation_cases SET state='decision' WHERE id=$1",[appealCase]);
  await setup.query('COMMIT');setupTx=false;

  await first.query('BEGIN');firstTx=true;
  await first.query("SET LOCAL lock_timeout='7s'");
  await first.query("SET LOCAL statement_timeout='9s'");
  const expected={appeal_id:appeal,profile_id:profile,profile_version:1,outcome:'OVERTURN_REJECTION'};
  assert.deepEqual(await decideProfessionalAppeal(first,token.token,pepper,appeal,body),expected);
  // Until first COMMIT, neither the outcome nor the audit is visible elsewhere.
  assert.equal((await observer.query(
   'SELECT count(*)::int AS count FROM professional_moderation_appeal_decisions WHERE appeal_id=$1',[appeal]
  )).rows[0].count,0);
  await second.query('BEGIN');secondTx=true;
  await second.query("SET LOCAL lock_timeout='7s'");
  await second.query("SET LOCAL statement_timeout='9s'");
  const pid=(await second.query<{pid:number}>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid;
  let state:'pending'|'resolved'|'rejected'='pending';
  let replayError:unknown;
  let replayResult:unknown;
  const pending=decideProfessionalAppeal(second,token.token,pepper,appeal,body).then(
   result=>{state='resolved';replayResult=result;},
   error=>{state='rejected';replayError=error;},
  );
  let sawLock=false;
  try{
   const deadline=Date.now()+3500;
   while(Date.now()<deadline){
    const activity=await observer.query<{wait_event_type:string|null}>(
     'SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1',[pid]);
    if(activity.rows[0]?.wait_event_type==='Lock'){sawLock=true;break;}
    if(state!=='pending')break;
    await new Promise(resolve=>setTimeout(resolve,25));
   }
  }finally{
   // Release first even when assertion or observation fails: never strand B.
   await first.query('COMMIT');firstTx=false;
  }
  await pending;
  assert.equal(sawLock,true,'second adjudication must block on the committed case transition');
  assert.equal(state,'resolved',String(replayError));
  assert.deepEqual(replayResult,expected);
  await second.query('COMMIT');secondTx=false;

  await second.query('BEGIN');secondTx=true;
  await assert.rejects(
   decideProfessionalAppeal(second,token.token,pepper,appeal,
    {...body,outcome:'UPHOLD_REJECTION'}),ConflictException);
  await second.query('ROLLBACK');secondTx=false;

  assert.equal((await observer.query(
   "SELECT state FROM platform_moderation_cases WHERE id=$1",[appealCase])).rows[0].state,'closed');
  assert.deepEqual((await observer.query(
   'SELECT reviewer_staff_id::text AS reviewer,outcome FROM professional_moderation_appeal_decisions WHERE appeal_id=$1',
   [appeal])).rows,[{reviewer,outcome:'OVERTURN_REJECTION'}]);
  assert.deepEqual((await observer.query(
   'SELECT event_kind,actor_staff_id::text AS actor,reviewer_staff_id::text AS reviewer,outcome FROM professional_appeal_audit_events WHERE appeal_id=$1 ORDER BY event_kind',
   [appeal])).rows,[
    {event_kind:'APPEAL_DECIDED',actor:reviewer,reviewer,outcome:'OVERTURN_REJECTION'},
    {event_kind:'REVIEWER_ASSIGNED',actor:assigner,reviewer,outcome:null},
   ]);
  assert.equal((await observer.query('SELECT status FROM professional_profiles WHERE id=$1',[profile])).rows[0].status,'DRAFT');
 }finally{
  if(firstTx)await first.query('ROLLBACK').catch(()=>{});
  if(secondTx)await second.query('ROLLBACK').catch(()=>{});
  if(setupTx)await setup.query('ROLLBACK').catch(()=>{});
  // Immutable audit/decision fixtures intentionally remain only in the
  // disposable services_test CI DB; no production or shared DB is touched.
  await Promise.all([setup.end(),first.end(),second.end(),observer.end()]);
 }
});
