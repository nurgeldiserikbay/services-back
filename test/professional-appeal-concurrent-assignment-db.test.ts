import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomBytes,randomUUID} from 'node:crypto';
import {Client} from 'pg';
import {ConflictException} from '@nestjs/common';
import {issueAdminSessionToken} from '../src/modules/admin/admin-session-token.js';
import {assignProfessionalAppealReviewer} from '../src/modules/admin/admin-professional-appeal-assignment.js';

const connect=()=>new Client({connectionString:process.env.DATABASE_URL});

test('committed two-client reviewer assignment serializes exact replay and rejects conflict',async()=>{
 if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL required');
 const setup=connect(),first=connect(),second=connect(),observer=connect();
 const pepper=randomBytes(32),token=issueAdminSessionToken(pepper);
 const ownerUser=randomUUID(),person=randomUUID(),profession=randomUUID(),profile=randomUUID();
 const assignerUser=randomUUID(),reviewerUser=randomUUID(),alternateUser=randomUUID();
 const originalActor=randomUUID(),assigner=randomUUID(),reviewer=randomUUID(),alternateReviewer=randomUUID();
 const originalCase=randomUUID(),rejection=randomUUID(),appealCase=randomUUID(),appeal=randomUUID();
 const body={profile_id:profile,profile_version:1,reviewer_staff_id:reviewer};
 const otherBody={...body,reviewer_staff_id:alternateReviewer};
 const expected={appeal_id:appeal,reviewer_staff_id:reviewer,assigned_by_staff_id:assigner};
 let setupTx=false,firstTx=false,secondTx=false;
 await Promise.all([setup.connect(),first.connect(),second.connect(),observer.connect()]);
 try{
  const database=(await setup.query<{name:string}>('SELECT current_database() AS name')).rows[0]?.name;
  assert.equal(database,'services_test','Committed reviewer race requires disposable CI database');
  await setup.query('BEGIN');setupTx=true;
  await setup.query('INSERT INTO users(id) VALUES($1),($2),($3),($4)',
   [ownerUser,assignerUser,reviewerUser,alternateUser]);
  await setup.query('INSERT INTO persons(id,user_id) VALUES($1,$2)',[person,ownerUser]);
  await setup.query('INSERT INTO professions(id,code,name) VALUES($1,$2,$2)',[profession,profession]);
  await setup.query("INSERT INTO professional_profiles(id,person_id,profession_id,slug,status) VALUES($1,$2,$3,$4,'DRAFT')",
   [profile,person,profession,profile]);
  for(const [staff,user] of [[originalActor,ownerUser],[assigner,assignerUser],[reviewer,reviewerUser],[alternateReviewer,alternateUser]]){
   await setup.query("INSERT INTO platform_admin_staff(id,user_id,role) VALUES($1,$2,'admin')",[staff,user]);
  }
  for(const staff of [assigner,reviewer,alternateReviewer]){
   await setup.query('INSERT INTO platform_admin_grants(id,staff_id,scope) VALUES($1,$2,$3)',
    [randomUUID(),staff,'professional:'+profile]);
   await setup.query("INSERT INTO platform_admin_totp_factors(staff_id,encrypted_secret,key_version,created_at,activated_at) VALUES($1,'integration-test-placeholder-encrypted-envelope','test-v1',now()-interval '4 minutes',now()-interval '3 minutes')",[staff]);
  }
  await setup.query("INSERT INTO platform_admin_sessions(id,staff_id,token_hash,mfa_verified_at,expires_at) VALUES($1,$2,$3,now()-interval '1 minute',now()+interval '1 hour')",
   [randomUUID(),assigner,token.tokenHash]);
  await setup.query("INSERT INTO platform_moderation_cases(id,resource_scope,subject_kind,state) VALUES($1,$2,'professional','closed')",
   [originalCase,'professional:'+profile]);
  await setup.query("INSERT INTO professional_moderation_decisions(id,case_id,profile_id,profile_version,actor_staff_id,decision) VALUES($1,$2,$3,1,$4,'REJECT')",
   [rejection,originalCase,profile,originalActor]);
  await setup.query("INSERT INTO platform_moderation_cases(id,resource_scope,subject_kind,state) VALUES($1,$2,'professional','appeal')",
   [appealCase,'professional:'+profile]);
  await setup.query("INSERT INTO professional_moderation_appeals(id,original_decision_id,case_id,profile_id,profile_version,submitted_by_person_id) VALUES($1,$2,$3,$4,1,$5)",
   [appeal,rejection,appealCase,profile,person]);
  await setup.query('COMMIT');setupTx=false;

  await first.query('BEGIN');firstTx=true;
  await first.query("SET LOCAL lock_timeout='7s'");
  await first.query("SET LOCAL statement_timeout='9s'");
  assert.deepEqual(await assignProfessionalAppealReviewer(first,token.token,pepper,appeal,body),expected);
  assert.equal((await observer.query(
   'SELECT count(*)::int AS total FROM professional_appeal_review_assignments WHERE appeal_id=$1',[appeal]
  )).rows[0].total,0,'uncommitted allocation must remain invisible');
  assert.equal((await observer.query(
   'SELECT count(*)::int AS total FROM professional_appeal_audit_events WHERE appeal_id=$1',[appeal]
  )).rows[0].total,0,'uncommitted audit must remain invisible');

  await second.query('BEGIN');secondTx=true;
  await second.query("SET LOCAL lock_timeout='7s'");
  await second.query("SET LOCAL statement_timeout='9s'");
  const pid=(await second.query<{pid:number}>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid;
  let state:'pending'|'resolved'|'rejected'='pending';
  let replayResult:unknown,replayError:unknown;
  // Attach rejection handler immediately, before the first transaction commits.
  const pending=assignProfessionalAppealReviewer(second,token.token,pepper,appeal,body).then(
   value=>{state='resolved';replayResult=value;},
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
   await first.query('COMMIT');firstTx=false;
  }
  await pending;
  assert.equal(sawLock,true,'second reviewer allocation must wait for first case lock');
  assert.equal(state,'resolved',String(replayError));
  assert.deepEqual(replayResult,expected,'same assignment replay is idempotent');
  await second.query('COMMIT');secondTx=false;

  await second.query('BEGIN');secondTx=true;
  await assert.rejects(assignProfessionalAppealReviewer(second,token.token,pepper,appeal,otherBody),
   ConflictException,'different reviewer cannot replace immutable assignment');
  await second.query('ROLLBACK');secondTx=false;
  assert.deepEqual((await observer.query(
   'SELECT reviewer_staff_id::text AS reviewer,assigned_by_staff_id::text AS assigner FROM professional_appeal_review_assignments WHERE appeal_id=$1',[appeal]
  )).rows,[{reviewer,assigner}]);
  assert.deepEqual((await observer.query(
   'SELECT event_kind,actor_staff_id::text AS actor,reviewer_staff_id::text AS reviewer,outcome FROM professional_appeal_audit_events WHERE appeal_id=$1',[appeal]
  )).rows,[{event_kind:'REVIEWER_ASSIGNED',actor:assigner,reviewer,outcome:null}]);
  assert.equal((await observer.query('SELECT state FROM platform_moderation_cases WHERE id=$1',[appealCase])).rows[0].state,'appeal');
  assert.equal((await observer.query('SELECT status FROM professional_profiles WHERE id=$1',[profile])).rows[0].status,'DRAFT');
 }finally{
  if(firstTx)await first.query('ROLLBACK').catch(()=>{});
  if(secondTx)await second.query('ROLLBACK').catch(()=>{});
  if(setupTx)await setup.query('ROLLBACK').catch(()=>{});
  // A committed race fixture is restricted to disposable services_test.
  await Promise.all([setup.end(),first.end(),second.end(),observer.end()]);
 }
});
