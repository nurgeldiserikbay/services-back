import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomBytes,randomUUID} from 'node:crypto';
import {Client} from 'pg';
import {BadRequestException,ConflictException,UnauthorizedException} from '@nestjs/common';
import {issueAdminSessionToken} from '../src/modules/admin/admin-session-token.js';
import {decideProfessionalAppeal,parseProfessionalAppealDecision} from '../src/modules/admin/admin-professional-appeal-decision.js';

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
  await db.query("INSERT INTO platform_admin_totp_factors(staff_id,encrypted_secret,key_version,created_at,activated_at) VALUES($1,'test-encrypted-envelope','test-v1',now()-interval '4 minutes',now()-interval '3 minutes')",[reviewer]);
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
  const receipt=await decide();
  assert.deepEqual(receipt,{appeal_id:appeal,profile_id:profile,profile_version:1,outcome:'OVERTURN_REJECTION'});
  assert.deepEqual(await decide(),receipt);
  await assert.rejects(decide({...body,outcome:'UPHOLD_REJECTION'}),ConflictException);
  assert.equal((await db.query('SELECT count(*)::int AS count FROM professional_moderation_appeal_decisions WHERE appeal_id=$1',[appeal])).rows[0].count,1);
  assert.equal((await db.query('SELECT status FROM professional_profiles WHERE id=$1',[profile])).rows[0].status,'DRAFT');
 }finally{await db.query('ROLLBACK').catch(()=>{});await db.end();}
});
