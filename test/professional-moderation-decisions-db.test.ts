import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {Client} from 'pg';

test('professional moderation decision evidence binds closed case and exact profile version, then is immutable',async()=>{
 const db=new Client({connectionString:process.env.DATABASE_URL});
 await db.connect();await db.query('BEGIN');
 try{
  const user=randomUUID(),staff=randomUUID(),person=randomUUID(),profession=randomUUID();
  const profile=randomUUID(),caseId=randomUUID(),decisionId=randomUUID(),otherCase=randomUUID();
  await db.query('INSERT INTO users(id) VALUES($1)',[user]);
  await db.query('INSERT INTO persons(id,user_id) VALUES($1,$2)',[person,user]);
  await db.query('INSERT INTO professions(id,code,name) VALUES($1,$2,$2)',[profession,profession]);
  await db.query("INSERT INTO professional_profiles(id,person_id,profession_id,slug,status) VALUES($1,$2,$3,$4,'DRAFT')",[profile,person,profession,profile]);
  await db.query("INSERT INTO platform_admin_staff(id,user_id,role) VALUES($1,$2,'admin')",[staff,user]);
  await db.query("INSERT INTO platform_moderation_cases(id,resource_scope,subject_kind,state) VALUES($1,$2,'professional','triage')",[caseId,'professional:'+profile]);
  const insert=(caseValue:string,version:number,kind='APPROVE',id=decisionId)=>db.query(
   'INSERT INTO professional_moderation_decisions(id,case_id,profile_id,profile_version,actor_staff_id,decision) VALUES($1,$2,$3,$4,$5,$6)',
   [id,caseValue,profile,version,staff,kind]);
  const rejected=async(work:()=>Promise<unknown>,code:string)=>{
   await db.query('SAVEPOINT rejected');
   await assert.rejects(work(),(e:unknown)=>(e as {code?:string}).code===code);
   await db.query('ROLLBACK TO SAVEPOINT rejected');await db.query('RELEASE SAVEPOINT rejected');
  };
  await rejected(()=>insert(caseId,1),'23514');
  await db.query("UPDATE platform_moderation_cases SET state='closed' WHERE id=$1",[caseId]);
  await rejected(()=>insert(caseId,2),'23514');
  await db.query("INSERT INTO platform_moderation_cases(id,resource_scope,subject_kind,state) VALUES($1,$2,'professional','closed')",[otherCase,'professional:'+randomUUID()]);
  await rejected(()=>insert(otherCase,1),'23514');
  await rejected(()=>insert(caseId,1,'INVALID'),'23514');
  await insert(caseId,1);
  assert.deepEqual((await db.query(
   'SELECT profile_version,decision,actor_staff_id::text FROM professional_moderation_decisions WHERE id=$1',[decisionId])).rows,
   [{profile_version:1,decision:'APPROVE',actor_staff_id:staff}]);
  await rejected(()=>insert(caseId,1,'REJECT',randomUUID()),'23505');
  // An appeal is a distinct case with an immutable link to a REJECT.
  // Even if triage closes that case, raw SQL cannot forge a first-instance
  // approval in professional_moderation_decisions.
  const rejectionCase=randomUUID(),rejectionId=randomUUID(),appealCase=randomUUID();
  await db.query("INSERT INTO platform_moderation_cases(id,resource_scope,subject_kind,state) VALUES($1,$2,'professional','closed')",
   [rejectionCase,'professional:'+profile]);
  await insert(rejectionCase,1,'REJECT',rejectionId);
  await db.query("INSERT INTO platform_moderation_cases(id,resource_scope,subject_kind,state) VALUES($1,$2,'professional','appeal')",
   [appealCase,'professional:'+profile]);
  await db.query(
   'INSERT INTO professional_moderation_appeals(id,original_decision_id,case_id,profile_id,profile_version,submitted_by_person_id) VALUES($1,$2,$3,$4,1,$5)',
   [randomUUID(),rejectionId,appealCase,profile,person]);
  await db.query("UPDATE platform_moderation_cases SET state='closed' WHERE id=$1",[appealCase]);
  await rejected(()=>insert(appealCase,1,'APPROVE',randomUUID()),'23514');
  assert.equal((await db.query('SELECT count(*)::int AS total FROM professional_moderation_decisions WHERE case_id=$1',[appealCase])).rows[0].total,0);
  await rejected(()=>db.query("UPDATE professional_moderation_decisions SET decision='REJECT' WHERE id=$1",[decisionId]),'23514');
  await rejected(()=>db.query('DELETE FROM professional_moderation_decisions WHERE id=$1',[decisionId]),'23514');
 }finally{
  await db.query('ROLLBACK').catch(()=>{});await db.end();
 }
});
