import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {Client} from 'pg';

test('appeal outcome requires a separate reviewer and remains immutable without publishing',async()=>{
 const db=new Client({connectionString:process.env.DATABASE_URL});
 await db.connect();await db.query('BEGIN');
 try{
  const user=randomUUID(),person=randomUUID(),profession=randomUUID(),profile=randomUUID();
  const originalStaff=randomUUID(),reviewer=randomUUID(),originalCase=randomUUID(),appealCase=randomUUID();
  const rejection=randomUUID(),appeal=randomUUID(),outcome=randomUUID();
  await db.query('INSERT INTO users(id) VALUES($1)',[user]);
  await db.query('INSERT INTO persons(id,user_id) VALUES($1,$2)',[person,user]);
  await db.query('INSERT INTO professions(id,code,name) VALUES($1,$2,$2)',[profession,profession]);
  await db.query("INSERT INTO professional_profiles(id,person_id,profession_id,slug,status) VALUES($1,$2,$3,$4,'DRAFT')",[profile,person,profession,profile]);
  await db.query("INSERT INTO platform_admin_staff(id,user_id,role) VALUES($1,$2,'admin')",[originalStaff,user]);
  const reviewerUser=randomUUID();
  await db.query('INSERT INTO users(id) VALUES($1)',[reviewerUser]);
  await db.query("INSERT INTO platform_admin_staff(id,user_id,role) VALUES($1,$2,'admin')",[reviewer,reviewerUser]);
  await db.query("INSERT INTO platform_moderation_cases(id,resource_scope,subject_kind,state) VALUES($1,$2,'professional','closed')",[originalCase,'professional:'+profile]);
  await db.query("INSERT INTO professional_moderation_decisions(id,case_id,profile_id,profile_version,actor_staff_id,decision) VALUES($1,$2,$3,1,$4,'REJECT')",[rejection,originalCase,profile,originalStaff]);
  await db.query("INSERT INTO platform_moderation_cases(id,resource_scope,subject_kind,state) VALUES($1,$2,'professional','appeal')",[appealCase,'professional:'+profile]);
  await db.query('INSERT INTO professional_moderation_appeals(id,original_decision_id,case_id,profile_id,profile_version,submitted_by_person_id) VALUES($1,$2,$3,$4,1,$5)',[appeal,rejection,appealCase,profile,person]);
  const add=(actor:string,id=randomUUID(),decision='OVERTURN_REJECTION')=>db.query(
   'INSERT INTO professional_moderation_appeal_decisions(id,appeal_id,reviewer_staff_id,outcome) VALUES($1,$2,$3,$4)',[id,appeal,actor,decision]);
  const reject=async(work:()=>Promise<unknown>,code:string)=>{
   await db.query('SAVEPOINT fail');
   await assert.rejects(work(),(err:unknown)=>(err as {code?:string}).code===code);
   await db.query('ROLLBACK TO SAVEPOINT fail');await db.query('RELEASE SAVEPOINT fail');
  };
  await reject(()=>add(originalStaff),'23514');
  await reject(()=>add(reviewer),'23514'); // appeal is still open
  await db.query("UPDATE platform_moderation_cases SET state='closed' WHERE id=$1",[appealCase]);
  await reject(()=>add(originalStaff),'23514');
  await reject(()=>add(reviewer,randomUUID(),'INVALID'),'23514');
  await add(reviewer,outcome);
  await reject(()=>add(reviewer),'23505');
  await reject(()=>db.query("UPDATE professional_moderation_appeal_decisions SET outcome='UPHOLD_REJECTION' WHERE id=$1",[outcome]),'23514');
  await reject(()=>db.query('DELETE FROM professional_moderation_appeal_decisions WHERE id=$1',[outcome]),'23514');
  assert.deepEqual((await db.query('SELECT reviewer_staff_id::text AS reviewer,outcome FROM professional_moderation_appeal_decisions WHERE id=$1',[outcome])).rows,[{reviewer,outcome:'OVERTURN_REJECTION'}]);
  assert.equal((await db.query('SELECT status FROM professional_profiles WHERE id=$1',[profile])).rows[0].status,'DRAFT');
  assert.equal((await db.query('SELECT count(*)::int AS count FROM professional_moderation_decisions WHERE case_id=$1',[appealCase])).rows[0].count,0);
 }finally{await db.query('ROLLBACK').catch(()=>{});await db.end();}
});
