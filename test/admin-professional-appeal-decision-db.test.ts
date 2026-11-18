import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomBytes,randomUUID} from 'node:crypto';
import {Client} from 'pg';
import {BadRequestException,ConflictException,UnauthorizedException} from '@nestjs/common';
import {issueAdminSessionToken} from '../src/modules/admin/admin-session-token.js';
import {decideProfessionalAppeal,parseProfessionalAppealDecision} from '../src/modules/admin/admin-professional-appeal-decision.js';
import {assignProfessionalAppealReviewer,parseAppealReviewerAssignment} from '../src/modules/admin/admin-professional-appeal-assignment.js';

test('independent appeal core enforces scoped fresh MFA, reviewer separation, exact version and immutable outcome',async()=>{
 const db=new Client({connectionString:process.env.DATABASE_URL});
 const pepper=randomBytes(32),token=issueAdminSessionToken(pepper);
 const ownerUser=randomUUID(),person=randomUUID(),profession=randomUUID(),profile=randomUUID();
 const actor=randomUUID(),reviewerUser=randomUUID(),reviewer=randomUUID(),session=randomUUID(),grant=randomUUID();
 const originalCase=randomUUID(),rejection=randomUUID(),appealCase=randomUUID(),appeal=randomUUID();
 const body={profile_id:profile,profile_version:1,outcome:'OVERTURN_REJECTION'};
 await db.connect();await db.query('BEGIN');
 try{
  await db.query('INSERT INTO users(id) VALUES($1)',[ownerUser]);
  await db.query('INSERT INTO persons(id,user_id) VALUES($1,$2)',[person,ownerUser]);
  await db.query('INSERT INTO professions(id,code,name) VALUES($1,$2,$2)',[profession,profession]);
  await db.query("INSERT INTO professional_profiles(id,person_id,profession_id,slug,status) VALUES($1,$2,$3,$4,'DRAFT')",[profile,person,profession,profile]);
  await db.query("INSERT INTO platform_admin_staff(id,user_id,role) VALUES($1,$2,'admin')",[actor,ownerUser]);
  await db.query('INSERT INTO users(id) VALUES($1)',[reviewerUser]);
  await db.query("INSERT INTO platform_admin_staff(id,user_id,role) VALUES($1,$2,'admin')",[reviewer,reviewerUser]);
  await db.query('INSERT INTO platform_admin_grants(id,staff_id,scope) VALUES($1,$2,$3)',[grant,reviewer,'professional:'+profile]);
  await db.query("INSERT INTO platform_admin_sessions(id,staff_id,token_hash,mfa_verified_at,expires_at) VALUES($1,$2,$3,now()-interval '1 minute',now()+interval '1 hour')",[session,reviewer,token.tokenHash]);
  await db.query("INSERT INTO platform_admin_totp_factors(staff_id,encrypted_secret,key_version,created_at,activated_at) VALUES($1,'integration-test-placeholder-encrypted-envelope','test-v1',now()-interval '4 minutes',now()-interval '3 minutes')",[reviewer]);
  await db.query("INSERT INTO platform_moderation_cases(id,resource_scope,subject_kind,state) VALUES($1,$2,'professional','closed')",[originalCase,'professional:'+profile]);
  await db.query("INSERT INTO professional_moderation_decisions(id,case_id,profile_id,profile_version,actor_staff_id,decision) VALUES($1,$2,$3,1,$4,'REJECT')",[rejection,originalCase,profile,actor]);
  await db.query("INSERT INTO platform_moderation_cases(id,resource_scope,subject_kind,state) VALUES($1,$2,'professional','appeal')",[appealCase,'professional:'+profile]);
  await db.query("INSERT INTO professional_moderation_appeals(id,original_decision_id,case_id,profile_id,profile_version,submitted_by_person_id) VALUES($1,$2,$3,$4,1,$5)",[appeal,rejection,appealCase,profile,person]);
  const decide=(b:unknown=body)=>decideProfessionalAppeal(db,token.token,pepper,appeal,b);
  assert.deepEqual(parseProfessionalAppealDecision(appeal,body),{appealId:appeal,profileId:profile,profileVersion:1,outcome:'OVERTURN_REJECTION'});
  for(const b of [null,{},[],{...body,extra:true},{...body,outcome:'APPROVE'},{...body,profile_version:0}]){
   assert.throws(()=>parseProfessionalAppealDecision(appeal,b),BadRequestException);
  }
  await assert.rejects(decide(),ConflictException,'intake is not decision-ready');
  await db.query("UPDATE platform_moderation_cases SET state='decision' WHERE id=$1",[appealCase]);
  await db.query("UPDATE platform_admin_staff SET role='operator' WHERE id=$1",[reviewer]);
  await assert.rejects(decide(),UnauthorizedException);
  await db.query("UPDATE platform_admin_staff SET role='admin' WHERE id=$1",[reviewer]);
  await db.query('DELETE FROM platform_admin_grants WHERE id=$1',[grant]);
  await assert.rejects(decide(),UnauthorizedException);
  await db.query('INSERT INTO platform_admin_grants(id,staff_id,scope) VALUES($1,$2,$3)',[grant,reviewer,'professional:'+profile]);
  await db.query("UPDATE platform_admin_sessions SET mfa_verified_at=now()-interval '16 minutes' WHERE id=$1",[session]);
  await assert.rejects(decide(),UnauthorizedException);
  await db.query("UPDATE platform_admin_sessions SET mfa_verified_at=now()-interval '1 minute' WHERE id=$1",[session]);
  // The original decision actor must not adjudicate its own appeal.
  await db.query('SAVEPOINT immutable_actor');
  await assert.rejects(db.query('UPDATE professional_moderation_decisions SET actor_staff_id=$1 WHERE id=$2',[reviewer,rejection]),
   (error:unknown)=>(error as {code?:string}).code==='23514');
  await db.query('ROLLBACK TO SAVEPOINT immutable_actor');
  await db.query('RELEASE SAVEPOINT immutable_actor');
  // Above immutable evidence cannot be rewritten. The original actor stays independent.
  assert.equal((await db.query('SELECT actor_staff_id::text FROM professional_moderation_decisions WHERE id=$1',[rejection])).rows[0].actor_staff_id,actor);
  await assert.rejects(decide({...body,profile_version:2}),ConflictException);
  await db.query('UPDATE platform_admin_sessions SET revoked_at=now() WHERE id=$1',[session]);
  await assert.rejects(decide(),UnauthorizedException);
  await db.query('UPDATE platform_admin_sessions SET revoked_at=NULL WHERE id=$1',[session]);
  assert.equal((await db.query('SELECT count(*)::int AS count FROM professional_moderation_appeal_decisions WHERE appeal_id=$1',[appeal])).rows[0].count,0);
  // A scoped, MFA-verified reviewer alone cannot decide before independent
  // three-party assignment evidence is recorded.
  await assert.rejects(decide(),ConflictException);
  const assignerUser=randomUUID(),assigner=randomUUID();
  await db.query('INSERT INTO users(id) VALUES($1)',[assignerUser]);
  await db.query("INSERT INTO platform_admin_staff(id,user_id,role) VALUES($1,$2,'admin')",[assigner,assignerUser]);
  const assignToken=issueAdminSessionToken(pepper);
  const assignSession=randomUUID(),assignGrant=randomUUID();
  const assignmentBody={profile_id:profile,profile_version:1,reviewer_staff_id:reviewer};
  assert.deepEqual(parseAppealReviewerAssignment(appeal,assignmentBody),
   {appealId:appeal,profileId:profile,profileVersion:1,reviewerStaffId:reviewer});
  for(const invalid of [null,{},[],{...assignmentBody,extra:true},{...assignmentBody,profile_version:0}]){
   assert.throws(()=>parseAppealReviewerAssignment(appeal,invalid),BadRequestException);
  }
  const assign=(input:unknown=assignmentBody)=>assignProfessionalAppealReviewer(
   db,assignToken.token,pepper,appeal,input);
  await assert.rejects(assign(),UnauthorizedException,'assigner needs live scoped session');
  await db.query('INSERT INTO platform_admin_grants(id,staff_id,scope) VALUES($1,$2,$3)',
   [assignGrant,assigner,'professional:'+profile]);
  await db.query("INSERT INTO platform_admin_sessions(id,staff_id,token_hash,mfa_verified_at,expires_at) VALUES($1,$2,$3,now()-interval '1 minute',now()+interval '1 hour')",
   [assignSession,assigner,assignToken.tokenHash]);
  await db.query("INSERT INTO platform_admin_totp_factors(staff_id,encrypted_secret,key_version,created_at,activated_at) VALUES($1,'integration-test-placeholder-encrypted-envelope','test-v1',now()-interval '4 minutes',now()-interval '3 minutes')",[assigner]);
  await assert.rejects(assign({...assignmentBody,reviewer_staff_id:assigner}),ConflictException);
  await assert.rejects(assign({...assignmentBody,reviewer_staff_id:actor}),ConflictException);
  await assert.rejects(assign({...assignmentBody,profile_version:2}),ConflictException);
  await db.query("UPDATE platform_admin_staff SET role='operator' WHERE id=$1",[assigner]);
  await assert.rejects(assign(),UnauthorizedException);
  await db.query("UPDATE platform_admin_staff SET role='admin' WHERE id=$1",[assigner]);
  await db.query("UPDATE platform_admin_sessions SET mfa_verified_at=now()-interval '16 minutes' WHERE id=$1",[assignSession]);
  await assert.rejects(assign(),UnauthorizedException);
  await db.query("UPDATE platform_admin_sessions SET mfa_verified_at=now()-interval '1 minute' WHERE id=$1",[assignSession]);
  await db.query('UPDATE platform_admin_sessions SET revoked_at=now() WHERE id=$1',[assignSession]);
  await assert.rejects(assign(),UnauthorizedException);
  await db.query('UPDATE platform_admin_sessions SET revoked_at=NULL WHERE id=$1',[assignSession]);
  await db.query('DELETE FROM platform_admin_grants WHERE id=$1',[assignGrant]);
  await assert.rejects(assign(),UnauthorizedException);
  await db.query('INSERT INTO platform_admin_grants(id,staff_id,scope) VALUES($1,$2,$3)',
   [assignGrant,assigner,'professional:'+profile]);
  // Allocation and its audit must also be atomic. The temporary trigger is
  // removed by rolling back the savepoint, with no assignment left behind.
  await db.query('SAVEPOINT before_assignment_audit_failure');
  await db.query(`
   CREATE FUNCTION pg_temp.reject_professional_appeal_assignment_audit()
   RETURNS trigger LANGUAGE plpgsql AS $$
   BEGIN
    RAISE EXCEPTION 'test_assignment_audit_failure' USING ERRCODE='23514';
   END;
   $$`);
  await db.query(`
   CREATE TRIGGER zz_test_reject_professional_appeal_assignment_audit
   BEFORE INSERT ON professional_appeal_audit_events
   FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_professional_appeal_assignment_audit()`);
  await assert.rejects(assign(),(error:unknown)=>
   (error as {code?:string;message?:string}).code==='23514'&&
   (error as {message?:string}).message==='test_assignment_audit_failure');
  await db.query('ROLLBACK TO SAVEPOINT before_assignment_audit_failure');
  await db.query('RELEASE SAVEPOINT before_assignment_audit_failure');
  assert.equal((await db.query('SELECT count(*)::int AS count FROM professional_appeal_review_assignments WHERE appeal_id=$1',[appeal])).rows[0].count,0);
  assert.equal((await db.query('SELECT count(*)::int AS count FROM professional_appeal_audit_events WHERE appeal_id=$1',[appeal])).rows[0].count,0);
  const assignment={appeal_id:appeal,reviewer_staff_id:reviewer,assigned_by_staff_id:assigner};
  assert.deepEqual(await assign(),assignment);
  assert.deepEqual(await assign(),assignment,'exact same assignment is idempotent');
  assert.deepEqual((await db.query(
   "SELECT event_kind,actor_staff_id::text AS actor,reviewer_staff_id::text AS reviewer,outcome FROM professional_appeal_audit_events WHERE appeal_id=$1 ORDER BY event_kind",
   [appeal])).rows,[{event_kind:'REVIEWER_ASSIGNED',actor:assigner,reviewer,outcome:null}]);

  await assert.rejects(assign({...assignmentBody,reviewer_staff_id:actor}),ConflictException);
  assert.equal((await db.query('SELECT count(*)::int AS count FROM professional_appeal_review_assignments WHERE appeal_id=$1',[appeal])).rows[0].count,1);
  // A separately authenticated and granted initial decision actor still
  // cannot adjudicate their own rejection, even with fresh activated MFA.
  const actorToken=issueAdminSessionToken(pepper);
  await db.query('INSERT INTO platform_admin_grants(id,staff_id,scope) VALUES($1,$2,$3)',
   [randomUUID(),actor,'professional:'+profile]);
  await db.query("INSERT INTO platform_admin_sessions(id,staff_id,token_hash,mfa_verified_at,expires_at) VALUES($1,$2,$3,now()-interval '1 minute',now()+interval '1 hour')",
   [randomUUID(),actor,actorToken.tokenHash]);
  await db.query("INSERT INTO platform_admin_totp_factors(staff_id,encrypted_secret,key_version,created_at,activated_at) VALUES($1,'integration-test-placeholder-encrypted-envelope','test-v1',now()-interval '4 minutes',now()-interval '3 minutes')",[actor]);
  await assert.rejects(
   decideProfessionalAppeal(db,actorToken.token,pepper,appeal,body),ConflictException);
  assert.equal((await db.query('SELECT state FROM platform_moderation_cases WHERE id=$1',[appealCase])).rows[0].state,'decision');
  // Inject a transaction-local audit write failure. The appeal decision
  // closes the case before its INSERT; the audit trigger must fail the entire
  // caller transaction, never leave a closed case without an outcome.
  await db.query('SAVEPOINT before_audit_failure');
  await db.query(`
   CREATE FUNCTION pg_temp.reject_professional_appeal_audit()
   RETURNS trigger LANGUAGE plpgsql AS $$
   BEGIN
    RAISE EXCEPTION 'test_appeal_audit_failure' USING ERRCODE='23514';
   END;
   $$`);
  await db.query(`
   CREATE TRIGGER zz_test_reject_professional_appeal_audit
   BEFORE INSERT ON professional_appeal_audit_events
   FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_professional_appeal_audit()`);
  await assert.rejects(decide(),(error:unknown)=>
   (error as {code?:string;message?:string}).code==='23514'&&
   (error as {message?:string}).message==='test_appeal_audit_failure');
  await db.query('ROLLBACK TO SAVEPOINT before_audit_failure');
  await db.query('RELEASE SAVEPOINT before_audit_failure');
  assert.equal((await db.query('SELECT state FROM platform_moderation_cases WHERE id=$1',[appealCase])).rows[0].state,'decision');
  assert.equal((await db.query('SELECT count(*)::int AS count FROM professional_moderation_appeal_decisions WHERE appeal_id=$1',[appeal])).rows[0].count,0);
  assert.deepEqual((await db.query('SELECT event_kind FROM professional_appeal_audit_events WHERE appeal_id=$1',[appeal])).rows,
   [{event_kind:'REVIEWER_ASSIGNED'}]);
  const receipt=await decide();
  assert.deepEqual(receipt,{appeal_id:appeal,profile_id:profile,profile_version:1,outcome:'OVERTURN_REJECTION'});
  assert.deepEqual(await decide(),receipt);
  assert.deepEqual((await db.query(
   "SELECT event_kind,actor_staff_id::text AS actor,reviewer_staff_id::text AS reviewer,outcome FROM professional_appeal_audit_events WHERE appeal_id=$1 ORDER BY event_kind",
   [appeal])).rows,[
    {event_kind:'APPEAL_DECIDED',actor:reviewer,reviewer,outcome:'OVERTURN_REJECTION'},
    {event_kind:'REVIEWER_ASSIGNED',actor:assigner,reviewer,outcome:null},
   ]);
  await db.query('SAVEPOINT audit_immutable');
  await assert.rejects(db.query("DELETE FROM professional_appeal_audit_events WHERE appeal_id=$1",[appeal]),
   (error:unknown)=>(error as {code?:string}).code==='23514');
  await db.query('ROLLBACK TO SAVEPOINT audit_immutable');
  await db.query('RELEASE SAVEPOINT audit_immutable');

  await assert.rejects(decide({...body,outcome:'UPHOLD_REJECTION'}),ConflictException);
  assert.equal((await db.query('SELECT count(*)::int AS count FROM professional_moderation_appeal_decisions WHERE appeal_id=$1',[appeal])).rows[0].count,1);
  assert.equal((await db.query('SELECT status FROM professional_profiles WHERE id=$1',[profile])).rows[0].status,'DRAFT');
 }finally{await db.query('ROLLBACK').catch(()=>{});await db.end();}
});
