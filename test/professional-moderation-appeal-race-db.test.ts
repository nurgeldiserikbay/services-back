import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {Client} from 'pg';

const connect=()=>new Client({connectionString:process.env.DATABASE_URL});
const fixture=()=>({
 user:randomUUID(),person:randomUUID(),profession:randomUUID(),profile:randomUUID(),
 caseId:randomUUID(),staff:randomUUID(),
});
async function insertProfile(db:Client,f:ReturnType<typeof fixture>){
 await db.query('INSERT INTO users(id) VALUES($1)',[f.user]);
 await db.query('INSERT INTO persons(id,user_id) VALUES($1,$2)',[f.person,f.user]);
 await db.query('INSERT INTO professions(id,code,name) VALUES($1,$2,$2)',[f.profession,f.profession]);
 await db.query("INSERT INTO professional_profiles(id,person_id,profession_id,slug,status) VALUES($1,$2,$3,$4,'DRAFT')",
  [f.profile,f.person,f.profession,f.profile]);
}
test('a completed moderation decision makes its case state immutable; appeal requires a separate case',async()=>{
 const db=connect();await db.connect();await db.query('BEGIN');
 try{
  const f=fixture();await insertProfile(db,f);
  await db.query("INSERT INTO platform_admin_staff(id,user_id,role) VALUES($1,$2,'admin')",[f.staff,f.user]);
  await db.query("INSERT INTO platform_moderation_cases(id,resource_scope,subject_kind,state) VALUES($1,$2,'professional','closed')",
   [f.caseId,'professional:'+f.profile]);
  await db.query("INSERT INTO professional_moderation_decisions(id,case_id,profile_id,profile_version,actor_staff_id,decision) VALUES($1,$2,$3,1,$4,'APPROVE')",
   [randomUUID(),f.caseId,f.profile,f.staff]);
  for(const sql of [
   "UPDATE platform_moderation_cases SET state='appeal' WHERE id=$1",
   "UPDATE platform_moderation_cases SET state='closed' WHERE id=$1",
   "UPDATE platform_moderation_cases SET subject_kind='review' WHERE id=$1",
  ]){
   await db.query('SAVEPOINT denied');
   await assert.rejects(db.query(sql,[f.caseId]),(error:unknown)=>(error as {code?:string}).code==='23514');
   await db.query('ROLLBACK TO SAVEPOINT denied');await db.query('RELEASE SAVEPOINT denied');
  }
  assert.equal((await db.query('SELECT state FROM platform_moderation_cases WHERE id=$1',[f.caseId])).rows[0].state,'closed');
  const appeal=randomUUID();
  await db.query("INSERT INTO platform_moderation_cases(id,resource_scope,subject_kind,state) VALUES($1,$2,'professional','appeal')",
   [appeal,'professional:'+f.profile]);
  assert.equal((await db.query('SELECT state FROM platform_moderation_cases WHERE id=$1',[appeal])).rows[0].state,'appeal');
 }finally{await db.query('ROLLBACK').catch(()=>{});await db.end();}
});

test('opening a professional appeal waits for the publication profile lock',async()=>{
 if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL required');
 const a=connect(),b=connect(),observer=connect(),f=fixture();
 let created=false,aTx=false,bTx=false;
 await Promise.all([a.connect(),b.connect(),observer.connect()]);
 try{
  const database=(await a.query<{name:string}>('SELECT current_database() AS name')).rows[0]?.name;
  assert.equal(database,'services_test','Committed two-client race fixture requires disposable CI database');
  await a.query('BEGIN');aTx=true;
  await insertProfile(a,f);
  await a.query('COMMIT');aTx=false;created=true;
  await a.query('BEGIN');aTx=true;
  await a.query('SELECT id FROM professional_profiles WHERE id=$1 FOR UPDATE',[f.profile]);
  assert.equal((await a.query("SELECT count(*)::int AS total FROM platform_moderation_cases WHERE resource_scope=$1 AND state<>'closed'",['professional:'+f.profile])).rows[0].total,0);
  await b.query('BEGIN');bTx=true;
  await b.query("SET LOCAL lock_timeout='6s'");
  await b.query("SET LOCAL statement_timeout='8s'");
  const pid=(await b.query<{pid:number}>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid;
  let outcome:'waiting'|'succeeded'|'rejected'='waiting';
  let rejected:unknown;
  const pending=b.query(
   "INSERT INTO platform_moderation_cases(id,resource_scope,subject_kind,state) VALUES($1,$2,'professional','appeal')",
   [f.caseId,'professional:'+f.profile],
  ).then(()=>{outcome='succeeded';},error=>{outcome='rejected';rejected=error;});
  let blocked=false;
  try{
   const deadline=Date.now()+3500;
   while(Date.now()<deadline){
    const status=await observer.query<{wait_event_type:string|null}>(
     'SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1',[pid]);
    if(status.rows[0]?.wait_event_type==='Lock'){blocked=true;break;}
    if(outcome!=='waiting')break;
    await new Promise(resolve=>setTimeout(resolve,25));
   }
  }finally{
   // Free A before waiting for B, even on test assertion failure.
   await a.query('COMMIT');aTx=false;
  }
  await pending;
  assert.equal(blocked,true,'new appeal must wait for the publication profile lock');
  assert.equal(outcome,'succeeded',String(rejected));
  await b.query('COMMIT');bTx=false;
  assert.equal((await a.query("SELECT count(*)::int AS total FROM platform_moderation_cases WHERE resource_scope=$1 AND state='appeal'",['professional:'+f.profile])).rows[0].total,1);
 }finally{
  if(aTx)await a.query('ROLLBACK').catch(()=>{});
  if(bTx)await b.query('ROLLBACK').catch(()=>{});
  if(created){
   await a.query('BEGIN');
   try{
    await a.query('DELETE FROM platform_moderation_cases WHERE id=$1',[f.caseId]);
    await a.query('DELETE FROM professional_profiles WHERE id=$1',[f.profile]);
    await a.query('DELETE FROM professions WHERE id=$1',[f.profession]);
    await a.query('DELETE FROM persons WHERE id=$1',[f.person]);
    await a.query('DELETE FROM users WHERE id=$1',[f.user]);
    await a.query('COMMIT');
   }catch(error){await a.query('ROLLBACK').catch(()=>{});throw error;}
  }
  await Promise.all([a.end(),b.end(),observer.end()]);
 }
});
