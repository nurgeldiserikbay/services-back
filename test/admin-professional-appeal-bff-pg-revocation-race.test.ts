import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomBytes,randomUUID} from 'node:crypto';
import {setTimeout as sleep} from 'node:timers/promises';
import {Client} from 'pg';
import {issueAdminSessionToken,hashAdminSessionToken} from '../src/modules/admin/admin-session-token.js';
import {createAppealBffPgAuthorizedSessionInsert} from '../src/modules/admin/admin-professional-appeal-bff-pg-authorized-insert.js';

/**
 * Two real PostgreSQL connections and one isolated temporary test schema.
 * Each connection gets a separate transaction and shares the same test rows.
 * No existing platform/admin tables are modified. This tests only the
 * admin-session row-lock ordering, NOT grant/MFA races or revocation cascade.
 */
test('two-client PostgreSQL BFF admission serializes with privileged session revocation',{
 skip:!process.env.DATABASE_URL,
 timeout:30_000,
},async()=>{
 const schema='bff_race_'+randomUUID().replaceAll('-','_');
 const a=new Client({connectionString:process.env.DATABASE_URL});
 const b=new Client({connectionString:process.env.DATABASE_URL});
 await a.connect();
 try{
  await b.connect();
  await a.query('CREATE SCHEMA "'+schema+'"');
  for(const client of [a,b]){
   await client.query('SET search_path TO "'+schema+'", public');
   await client.query('SET statement_timeout = 8000');
   await client.query('SET lock_timeout = 7000');
  }
  await a.query('CREATE TABLE users (id uuid PRIMARY KEY,status text NOT NULL)');
  await a.query('CREATE TABLE platform_admin_staff (id uuid PRIMARY KEY,user_id uuid NOT NULL,role text NOT NULL,disabled_at timestamptz)');
  await a.query('CREATE TABLE platform_admin_sessions (id uuid NOT NULL DEFAULT gen_random_uuid(),staff_id uuid NOT NULL, token_hash char(64) NOT NULL, revoked_at timestamptz, created_at timestamptz NOT NULL, expires_at timestamptz NOT NULL, mfa_verified_at timestamptz NOT NULL)');
  await a.query('CREATE TABLE platform_admin_totp_factors (staff_id uuid NOT NULL,activated_at timestamptz,disabled_at timestamptz)');
  await a.query('CREATE TABLE platform_admin_grants (staff_id uuid NOT NULL,scope text NOT NULL)');
  await a.query('CREATE TABLE platform_admin_appeal_browser_sessions (id uuid PRIMARY KEY,staff_id uuid NOT NULL,admin_session_id uuid NOT NULL,token_hash char(64) UNIQUE NOT NULL,expires_at timestamptz NOT NULL,revoked_at timestamptz)');
  const userId=randomUUID(),staffId=randomUUID(),pepper=randomBytes(32);
  const bearer=issueAdminSessionToken(pepper).token,scope='professional:'+randomUUID();
  const now=Date.now(),authHash=hashAdminSessionToken(bearer,pepper);
  const expiry=now+60_000;
  await a.query('INSERT INTO users(id,status) VALUES($1,$2)',[userId,'ACTIVE']);
  await a.query('INSERT INTO platform_admin_staff(id,user_id,role) VALUES($1,$2,$3)',[staffId,userId,'admin']);
  await a.query('INSERT INTO platform_admin_totp_factors(staff_id,activated_at) VALUES($1,$2)',[staffId,new Date(now-120_000)]);
  await a.query('INSERT INTO platform_admin_grants(staff_id,scope) VALUES($1,$2)',[staffId,scope]);
  await a.query(`INSERT INTO platform_admin_sessions(staff_id,token_hash,created_at,expires_at,mfa_verified_at)
   VALUES($1,$2,$3,$4,$5)`,[staffId,authHash,new Date(now-120_000),
   new Date(now+10*60_000),new Date(now-60_000)]);
  const makeInsert=(client:Client)=>createAppealBffPgAuthorizedSessionInsert(client,{
   adminBearer:bearer,adminPepper:pepper,resourceScope:scope,now,
  });
  const pidA=Number((await a.query<{pid:number}>('SELECT pg_backend_pid() AS pid')).rows[0]?.pid);
  const pidB=Number((await b.query<{pid:number}>('SELECT pg_backend_pid() AS pid')).rows[0]?.pid);
  assert.ok(Number.isSafeInteger(pidA)&&Number.isSafeInteger(pidB)&&pidA!==pidB);
  async function assertBlocked(observer:Client,blockedPid:number,blockerPid:number){
   for(let attempt=0;attempt<45;attempt++){
    const result=await observer.query<{pids:number[]}>(
     'SELECT pg_blocking_pids($1::integer) AS pids',[blockedPid]);
    if(result.rows[0]?.pids.includes(blockerPid))return;
    await sleep(40);
   }
   assert.fail('expected PostgreSQL lock contention on admin session row');
  }

  // Revocation wins: the browser issuance must observe revoked_at after the
  // concurrent updater releases its lock, and must not create any cookie row.
  await a.query('BEGIN');
  await a.query('UPDATE platform_admin_sessions SET revoked_at=now() WHERE token_hash=$1',[authHash]);
  const deniedHash=randomBytes(32).toString('hex');
  const deniedPromise=makeInsert(b)(deniedHash,expiry);
  await assertBlocked(a,pidB,pidA);
  await a.query('COMMIT');
  assert.equal(await deniedPromise,false);
  assert.equal((await a.query(
   'SELECT id FROM platform_admin_appeal_browser_sessions WHERE token_hash=$1',[deniedHash],
  )).rows.length,0);

  // Issuance wins: its row-share lock must hold until COMMIT. A concurrent
  // revocation UPDATE cannot commit before issuance's transaction commits.
  await a.query('UPDATE platform_admin_sessions SET revoked_at=NULL WHERE token_hash=$1',[authHash]);
  await a.query('BEGIN');
  const acceptedHash=randomBytes(32).toString('hex');
  assert.equal(await makeInsert(a)(acceptedHash,expiry),true);
  const revokePromise=b.query('UPDATE platform_admin_sessions SET revoked_at=now() WHERE token_hash=$1',[authHash]);
  await assertBlocked(a,pidB,pidA);
  await a.query('COMMIT');
  assert.equal((await revokePromise).rowCount,1);
  assert.equal((await a.query(
   'SELECT id FROM platform_admin_appeal_browser_sessions WHERE token_hash=$1',[acceptedHash],
  )).rows.length,1);
  assert.equal((await a.query(
   'SELECT revoked_at IS NOT NULL AS revoked FROM platform_admin_sessions WHERE token_hash=$1',[authHash],
  )).rows[0]?.revoked,true);
 }finally{
  try{await a.query('ROLLBACK');}catch{}
  try{await b.query('ROLLBACK');}catch{}
  try{await a.query('RESET search_path');await a.query('DROP SCHEMA IF EXISTS "'+schema+'" CASCADE');}catch{}
  await b.end().catch(()=>{});
  await a.end().catch(()=>{});
 }
});
