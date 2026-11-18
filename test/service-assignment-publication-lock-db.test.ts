import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {Client} from 'pg';

/**
 * Two committed PostgreSQL clients. An assignment reactivation must wait
 * while publication holds the profile's FOR UPDATE lock and checks for active
 * assignments. No publication/audit fixture or immutable revision is created.
 */
test('assignment reactivation serializes behind a publication profile lock',async()=>{
 if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL required');
 const a=new Client({connectionString:process.env.DATABASE_URL});
 const b=new Client({connectionString:process.env.DATABASE_URL});
 const user=randomUUID(),person=randomUUID(),profession=randomUUID(),definition=randomUUID();
 const profile=randomUUID(),offer=randomUUID(),assignment=randomUUID();
 let committed=false;let aInTransaction=false;let bInTransaction=false;
 try{
  await Promise.all([a.connect(),b.connect()]);
  const dbName=(await a.query<{name:string}>('SELECT current_database() AS name')).rows[0]?.name;
  assert.equal(dbName,'services_test','Committed concurrency fixture only runs against disposable CI database');
  await a.query('BEGIN');aInTransaction=true;
  await a.query('INSERT INTO users(id) VALUES($1)',[user]);
  await a.query('INSERT INTO persons(id,user_id) VALUES($1,$2)',[person,user]);
  await a.query('INSERT INTO professions(id,code,name) VALUES($1,$2,$2)',[profession,profession]);
  await a.query('INSERT INTO service_definitions(id,code,name) VALUES($1,$2,$2)',[definition,definition]);
  await a.query("INSERT INTO professional_profiles(id,person_id,profession_id,slug,status,title,about) VALUES($1,$2,$3,$4,'DRAFT','Electrician','Experienced specialist with service offer')",[profile,person,profession,profile]);
  await a.query("INSERT INTO service_offers(id,definition_id,professional_id,title,status,delivery_mode,contacts) VALUES($1,$2,$3,'Repairs','PUBLISHED','online','{}'::jsonb)",[offer,definition,profile]);
  await a.query("INSERT INTO service_assignments(id,offer_id,professional_id,status) VALUES($1,$2,$3,'REVOKED')",[assignment,offer,profile]);
  await a.query('COMMIT');aInTransaction=false;committed=true;

  await a.query('BEGIN');aInTransaction=true;
  await a.query('SELECT id FROM professional_profiles WHERE id=$1 FOR UPDATE',[profile]);
  assert.equal((await a.query("SELECT count(*)::int AS n FROM service_assignments WHERE professional_id=$1 AND status IN ('PROPOSED','ACCEPTED')",[profile])).rows[0].n,0);

  await b.query('BEGIN');bInTransaction=true;
  await b.query("SET LOCAL lock_timeout='5s'");
  await b.query("SET LOCAL statement_timeout='8s'");
  const pid=(await b.query<{pid:number}>('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  let finished=false;
  const pending=b.query("UPDATE service_assignments SET status='PROPOSED' WHERE id=$1",[assignment])
   .then(result=>{finished=true;return result;});
  // Observe a real PostgreSQL lock wait using a THIRD connection. Never queue
  // a new query onto B while its UPDATE is blocked on A.
  const c=new Client({connectionString:process.env.DATABASE_URL});
  try{
   await c.connect();
   const deadline=Date.now()+3000;
   let blocked=false;
   while(Date.now()<deadline){
    const wait=await c.query<{wait_event_type:string|null}>(
     'SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1',[pid]);
    if(wait.rows[0]?.wait_event_type==='Lock'){blocked=true;break;}
    if(finished)break;
    await new Promise(resolve=>setTimeout(resolve,30));
   }
   assert.equal(blocked,true,'assignment update must wait for the publication profile lock');
  }finally{
   // Release A first even on assertion failure, so B can complete/rollback.
   await a.query('COMMIT');aInTransaction=false;
   await c.end();
  }
  await pending;
  assert.equal(finished,true);
  await b.query('COMMIT');bInTransaction=false;
  assert.equal((await a.query('SELECT status FROM service_assignments WHERE id=$1',[assignment])).rows[0].status,'PROPOSED');
 }finally{
  if(aInTransaction)await a.query('ROLLBACK').catch(()=>{});
  if(bInTransaction)await b.query('ROLLBACK').catch(()=>{});
  if(committed){
   await a.query('BEGIN');
   try{
    await a.query('DELETE FROM service_assignments WHERE id=$1',[assignment]);
    await a.query('DELETE FROM service_offers WHERE id=$1',[offer]);
    await a.query('DELETE FROM professional_profiles WHERE id=$1',[profile]);
    await a.query('DELETE FROM service_definitions WHERE id=$1',[definition]);
    await a.query('DELETE FROM professions WHERE id=$1',[profession]);
    await a.query('DELETE FROM persons WHERE id=$1',[person]);
    await a.query('DELETE FROM users WHERE id=$1',[user]);
    await a.query('COMMIT');
   }catch(error){await a.query('ROLLBACK').catch(()=>{});throw error;}
  }
  await Promise.all([a.end(),b.end()]);
 }
});
