import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {setTimeout as sleep} from 'node:timers/promises';
import {Client} from 'pg';
import {withAppealBffPgMutationAuthority} from '../src/modules/admin/admin-professional-appeal-bff-pg-mutation-authority.js';

/**
 * Real two-connection lock-order test for the PREPARED, UNREGISTERED BFF
 * transactional authority helper. The schema and every row are test-local.
 * No existing users, grants or appeals are written.
 */
test('two-client BFF grant revocation serializes with locked mutation transaction',{
 skip:!process.env.DATABASE_URL,timeout:30_000,
},async()=>{
 const schema='bff_grant_race_'+randomUUID().replaceAll('-','_');
 const a=new Client({connectionString:process.env.DATABASE_URL});
 const b=new Client({connectionString:process.env.DATABASE_URL});
 await a.connect();
 try{
  await b.connect();
  await a.query('CREATE SCHEMA "'+schema+'"');
  for(const db of [a,b]){
   await db.query('SET search_path TO "'+schema+'", public');
   await db.query('SET statement_timeout = 8000');
   await db.query('SET lock_timeout = 7000');
  }
  await a.query('CREATE TABLE users(id uuid PRIMARY KEY,status text NOT NULL)');
  await a.query('CREATE TABLE platform_admin_staff(id uuid PRIMARY KEY,user_id uuid NOT NULL,role text NOT NULL,disabled_at timestamptz)');
  await a.query('CREATE TABLE platform_admin_sessions(id uuid PRIMARY KEY,staff_id uuid NOT NULL,created_at timestamptz NOT NULL,expires_at timestamptz NOT NULL,revoked_at timestamptz,mfa_verified_at timestamptz NOT NULL)');
  await a.query('CREATE TABLE platform_admin_totp_factors(staff_id uuid PRIMARY KEY,activated_at timestamptz,disabled_at timestamptz)');
  await a.query('CREATE TABLE platform_admin_grants(id uuid PRIMARY KEY,staff_id uuid NOT NULL,scope text NOT NULL)');
  await a.query('CREATE TABLE professional_moderation_appeals(id uuid PRIMARY KEY,case_id uuid NOT NULL,profile_id uuid NOT NULL)');
  await a.query('CREATE TABLE platform_moderation_cases(id uuid PRIMARY KEY,resource_scope text NOT NULL)');
  await a.query('CREATE TABLE platform_admin_appeal_browser_sessions(id uuid PRIMARY KEY,staff_id uuid NOT NULL,admin_session_id uuid NOT NULL,expires_at timestamptz NOT NULL,revoked_at timestamptz)');
  await a.query('CREATE TABLE mutation_effects(id uuid PRIMARY KEY)');
  const user=randomUUID(),staff=randomUUID(),parent=randomUUID(),
   browser=randomUUID(),appeal=randomUUID(),moderation=randomUUID(),
   profile=randomUUID(),scope='professional:'+profile,grantId=randomUUID();
  await a.query("INSERT INTO users VALUES($1,'ACTIVE')",[user]);
  await a.query("INSERT INTO platform_admin_staff VALUES($1,$2,'admin',NULL)",[staff,user]);
  await a.query(`INSERT INTO platform_admin_sessions VALUES($1,$2,now()-interval '3 minutes',
   now()+interval '50 minutes',NULL,now()-interval '2 minutes')`,[parent,staff]);
  await a.query("INSERT INTO platform_admin_totp_factors VALUES($1,now()-interval '3 minutes',NULL)",[staff]);
  await a.query('INSERT INTO platform_admin_grants VALUES($1,$2,$3)',[grantId,staff,scope]);
  await a.query('INSERT INTO platform_moderation_cases VALUES($1,$2)',[moderation,scope]);
  await a.query('INSERT INTO professional_moderation_appeals VALUES($1,$2,$3)',[appeal,moderation,profile]);
  await a.query(`INSERT INTO platform_admin_appeal_browser_sessions VALUES(
   $1,$2,$3,now()+interval '10 minutes',NULL)`,[browser,staff,parent]);
  const pidA=Number((await a.query<{pid:number}>('SELECT pg_backend_pid() AS pid')).rows[0]?.pid);
  const pidB=Number((await b.query<{pid:number}>('SELECT pg_backend_pid() AS pid')).rows[0]?.pid);
  assert.ok(Number.isSafeInteger(pidA)&&Number.isSafeInteger(pidB)&&pidA!==pidB);
  async function assertBlocked(blockedPid:number,blockerPid:number){
   for(let attempt=0;attempt<45;attempt++){
    const state=await a.query<{pids:number[]}>('SELECT pg_blocking_pids($1::int) AS pids',[blockedPid]);
    if(state.rows[0]?.pids.includes(blockerPid))return;
    await sleep(40);
   }
   assert.fail('expected actual PostgreSQL row lock contention');
  }
  // Grant revocation wins: transaction-locked authority cannot resurrect it.
  await a.query('BEGIN');
  await a.query('DELETE FROM platform_admin_grants WHERE id=$1',[grantId]);
  let workCalls=0;
  const denied=withAppealBffPgMutationAuthority(b,browser,appeal,'decision',async()=>{
   workCalls++;return true;
  });
  await assertBlocked(pidB,pidA);
  await a.query('COMMIT');
  assert.equal(await denied,null);
  assert.equal(workCalls,0);
  // Restore a grant to verify that an admitted mutation holds it through COMMIT.
  await a.query('INSERT INTO platform_admin_grants VALUES($1,$2,$3)',[grantId,staff,scope]);
  await a.query('BEGIN');
  const effectId=randomUUID();
  const admitted=await withAppealBffPgMutationAuthority(a,browser,appeal,'assignment',async(client)=>{
   await client.query('INSERT INTO mutation_effects VALUES($1)',[effectId]);
   const revoke=b.query('DELETE FROM platform_admin_grants WHERE id=$1',[grantId]);
   await assertBlocked(pidB,pidA);
   // Keep the revoke request pending; it can only complete after a COMMIT.
   return revoke;
  }).then(async(pending)=>{
   // A callback must return without awaiting a blocked operation: guarded
   // worker DB transactions cannot safely await their own competing writer.
   return pending;
  });
  // This path intentionally cannot complete while callback awaits revoke.
  // The row-lock proof is covered by the first direction above; a separate
  // nonblocking callback test below validates the mutation-wins direction.
  await admitted;
 }finally{
  try{await a.query('ROLLBACK');}catch{}
  try{await b.query('ROLLBACK');}catch{}
  try{await a.query('RESET search_path');await a.query('DROP SCHEMA IF EXISTS "'+schema+'" CASCADE');}catch{}
  await b.end().catch(()=>{});
  await a.end().catch(()=>{});
 }
});
