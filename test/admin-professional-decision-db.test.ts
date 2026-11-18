import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomBytes,randomUUID} from 'node:crypto';
import {Client} from 'pg';
import {BadRequestException,ConflictException,UnauthorizedException} from '@nestjs/common';
import {issueAdminSessionToken} from '../src/modules/admin/admin-session-token.js';
import {parseProfessionalDecision,decideProfessionalModerationCase} from '../src/modules/admin/admin-professional-decision.js';

test('professional moderation decision requires scoped fresh MFA and writes one immutable record',async()=>{
 const db=new Client({connectionString:process.env.DATABASE_URL});
 const pepper=randomBytes(32),token=issueAdminSessionToken(pepper);
 const user=randomUUID(),person=randomUUID(),staff=randomUUID(),session=randomUUID();
 const profession=randomUUID(),profile=randomUUID(),caseId=randomUUID(),grant=randomUUID();
 const body={profile_id:profile,profile_version:1,decision:'APPROVE'};
 await db.connect();await db.query('BEGIN');
 try{
  await db.query('INSERT INTO users(id) VALUES($1)',[user]);
  await db.query('INSERT INTO persons(id,user_id) VALUES($1,$2)',[person,user]);
  await db.query('INSERT INTO professions(id,code,name) VALUES($1,$2,$2)',[profession,profession]);
  await db.query("INSERT INTO professional_profiles(id,person_id,profession_id,slug,status) VALUES($1,$2,$3,$4,'DRAFT')",[profile,person,profession,profile]);
  await db.query("INSERT INTO platform_admin_staff(id,user_id,role) VALUES($1,$2,'operator')",[staff,user]);
  await db.query('INSERT INTO platform_admin_grants(id,staff_id,scope) VALUES($1,$2,$3)',[grant,staff,'professional:'+profile]);
  await db.query("INSERT INTO platform_admin_sessions(id,staff_id,token_hash,mfa_verified_at,expires_at) VALUES($1,$2,$3,now()-interval '1 minute',now()+interval '1 hour')",[session,staff,token.tokenHash]);
  await db.query("INSERT INTO platform_admin_totp_factors(staff_id,encrypted_secret,key_version,created_at,activated_at) VALUES($1,'integration-test-placeholder-encrypted-envelope','test-v1',now()-interval '4 minutes',now()-interval '3 minutes')",[staff]);
  await db.query("INSERT INTO platform_moderation_cases(id,resource_scope,subject_kind,state) VALUES($1,$2,'professional','decision')",[caseId,'professional:'+profile]);
  const decide=(value:unknown=body)=>decideProfessionalModerationCase(db,token.token,pepper,caseId,value);
  assert.deepEqual(parseProfessionalDecision(caseId,body),{caseId,profileId:profile,profileVersion:1,decision:'APPROVE'});
  for(const invalid of [null,{},[],{...body,secret:true},{...body,decision:'ALLOW'},{...body,profile_version:0}]){
   assert.throws(()=>parseProfessionalDecision(caseId,invalid),BadRequestException);
  }
  const receipt=await decide();
  assert.deepEqual(receipt,{case_id:caseId,profile_id:profile,profile_version:1,decision:'APPROVE'});
  assert.deepEqual(await decide(),receipt,'same actor and exact body replay is safe');
  const recorded=await db.query('SELECT decision,profile_version,actor_staff_id::text AS actor FROM professional_moderation_decisions WHERE case_id=$1',[caseId]);
  assert.deepEqual(recorded.rows,[{decision:'APPROVE',profile_version:1,actor:staff}]);
  assert.equal((await db.query('SELECT state FROM platform_moderation_cases WHERE id=$1',[caseId])).rows[0].state,'closed');
  await assert.rejects(decide({...body,decision:'REJECT'}),ConflictException);
  // This is a genuine owner rejection followed by immutable appeal intake.
  // A later triage move to "decision" MUST NOT let the ordinary moderator
  // endpoint close the appeal or produce approval evidence.
  const rejectionCase=randomUUID(),appealCase=randomUUID(),appealId=randomUUID();
  await db.query("INSERT INTO platform_moderation_cases(id,resource_scope,subject_kind,state) VALUES($1,$2,'professional','decision')",
   [rejectionCase,'professional:'+profile]);
  await decideProfessionalModerationCase(db,token.token,pepper,rejectionCase,{...body,decision:'REJECT'});
  const rejectedEvidence=await db.query<{id:string}>(
   'SELECT id::text FROM professional_moderation_decisions WHERE case_id=$1',[rejectionCase]);
  assert.equal(rejectedEvidence.rows.length,1);
  await db.query("INSERT INTO platform_moderation_cases(id,resource_scope,subject_kind,state) VALUES($1,$2,'professional','appeal')",
   [appealCase,'professional:'+profile]);
  await db.query(
   "INSERT INTO professional_moderation_appeals(id,original_decision_id,case_id,profile_id,profile_version,submitted_by_person_id) VALUES($1,$2,$3,$4,1,$5)",
   [appealId,rejectedEvidence.rows[0]!.id,appealCase,profile,person]);
  await db.query("UPDATE platform_moderation_cases SET state='decision' WHERE id=$1",[appealCase]);
  const before=(await db.query('SELECT count(*)::int AS total FROM professional_moderation_decisions WHERE case_id=$1',[appealCase])).rows[0].total;
  assert.equal(before,0);
  await assert.rejects(
   decideProfessionalModerationCase(db,token.token,pepper,appealCase,{...body,decision:'APPROVE'}),
   ConflictException);
  assert.equal((await db.query('SELECT state FROM platform_moderation_cases WHERE id=$1',[appealCase])).rows[0].state,'decision');
  assert.equal((await db.query('SELECT count(*)::int AS total FROM professional_moderation_decisions WHERE case_id=$1',[appealCase])).rows[0].total,0);

  // A malformed appeal evidence result must fail closed, even when a mock
  // driver/provider accidentally represents PostgreSQL boolean as text.
  const malformedEvidenceDb={
   query:async(sql:string,params?:unknown[])=>{
    if(sql.includes('FROM professional_moderation_appeals WHERE case_id'))
     return {rows:[{blocked:'false'}],rowCount:1};
    return db.query(sql,params);
   },
  } as unknown as Parameters<typeof decideProfessionalModerationCase>[0];
  await assert.rejects(
   decideProfessionalModerationCase(malformedEvidenceDb,token.token,pepper,appealCase,{...body,decision:'APPROVE'}),
   ConflictException);
  assert.equal((await db.query('SELECT state FROM platform_moderation_cases WHERE id=$1',[appealCase])).rows[0].state,'decision');
  assert.equal((await db.query('SELECT count(*)::int AS total FROM professional_moderation_decisions WHERE case_id=$1',[appealCase])).rows[0].total,0);

  // Defensive adapter regression: SQL EXISTS normally returns exactly one
  // boolean row. Missing or duplicated evidence must never authorize a write.
  for(const evidenceRows of [[],[{blocked:false},{blocked:false}]]){
   const invalidCardinalityDb={
    query:async(sql:string,params?:unknown[])=>{
     if(sql.includes('FROM professional_moderation_appeals WHERE case_id'))
      return {rows:evidenceRows,rowCount:evidenceRows.length};
     return db.query(sql,params);
    },
   } as unknown as Parameters<typeof decideProfessionalModerationCase>[0];
   await assert.rejects(
    decideProfessionalModerationCase(invalidCardinalityDb,token.token,pepper,appealCase,{...body,decision:'APPROVE'}),
    ConflictException);
   assert.equal((await db.query('SELECT state FROM platform_moderation_cases WHERE id=$1',[appealCase])).rows[0].state,'decision');
   assert.equal((await db.query('SELECT count(*)::int AS total FROM professional_moderation_decisions WHERE case_id=$1',[appealCase])).rows[0].total,0);
  }

  await db.query("UPDATE platform_admin_staff SET role='auditor' WHERE id=$1",[staff]);
  await assert.rejects(decide(),UnauthorizedException);
  await db.query("UPDATE platform_admin_staff SET role='operator' WHERE id=$1",[staff]);
  await db.query('DELETE FROM platform_admin_grants WHERE id=$1',[grant]);
  await assert.rejects(decide(),UnauthorizedException);
  await db.query('INSERT INTO platform_admin_grants(id,staff_id,scope) VALUES($1,$2,$3)',[grant,staff,'professional:'+profile]);
  await db.query("UPDATE platform_admin_sessions SET mfa_verified_at=now()-interval '16 minutes' WHERE id=$1",[session]);
  await assert.rejects(decide(),UnauthorizedException);
  await db.query("UPDATE platform_admin_sessions SET mfa_verified_at=now()-interval '1 minute' WHERE id=$1",[session]);
  await db.query('UPDATE platform_admin_sessions SET revoked_at=now() WHERE id=$1',[session]);
  await assert.rejects(decide(),UnauthorizedException);
 }finally{await db.query('ROLLBACK').catch(()=>{});await db.end();}
});
