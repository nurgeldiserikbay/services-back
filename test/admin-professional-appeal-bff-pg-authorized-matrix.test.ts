import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomBytes,randomUUID} from 'node:crypto';
import {Client} from 'pg';
import {issueAdminSessionToken,hashAdminSessionToken} from '../src/modules/admin/admin-session-token.js';
import {createAppealBffPgAuthorizedSessionInsert} from '../src/modules/admin/admin-professional-appeal-bff-pg-authorized-insert.js';

/**
 * Real PostgreSQL permission matrix using connection-local TEMP shadow tables.
 * No privileged user, grant or BFF session is written to the real schema.
 * Validates the actual INSERT SELECT, not mocked SQL text.
 */
test('real PostgreSQL BFF issuance grants only active MFA-verified scoped admin sessions',{
 skip:!process.env.DATABASE_URL,
},async()=>{
 const db=new Client({connectionString:process.env.DATABASE_URL});
 await db.connect();
 try{
  await db.query(`CREATE TEMP TABLE users(
   id uuid PRIMARY KEY,status text NOT NULL
  )`);
  await db.query(`CREATE TEMP TABLE platform_admin_staff(
   id uuid PRIMARY KEY,user_id uuid NOT NULL,role text NOT NULL,
   disabled_at timestamptz
  )`);
  await db.query(`CREATE TEMP TABLE platform_admin_sessions(
   staff_id uuid NOT NULL,token_hash char(64) NOT NULL,
   revoked_at timestamptz,created_at timestamptz NOT NULL,
   expires_at timestamptz NOT NULL,mfa_verified_at timestamptz NOT NULL
  )`);
  await db.query(`CREATE TEMP TABLE platform_admin_totp_factors(
   staff_id uuid NOT NULL,activated_at timestamptz,disabled_at timestamptz
  )`);
  await db.query(`CREATE TEMP TABLE platform_admin_grants(
   staff_id uuid NOT NULL,scope text NOT NULL
  )`);
  await db.query(`CREATE TEMP TABLE platform_admin_appeal_browser_sessions(
   id uuid PRIMARY KEY,staff_id uuid NOT NULL,token_hash char(64) UNIQUE NOT NULL,
   expires_at timestamptz NOT NULL,revoked_at timestamptz
  )`);
  const userId=randomUUID(),staffId=randomUUID(),pepper=randomBytes(32);
  const bearer=issueAdminSessionToken(pepper).token,scope='professional:'+randomUUID();
  const now=Date.now();
  await db.query('INSERT INTO users(id,status) VALUES($1,$2)',[userId,'ACTIVE']);
  await db.query('INSERT INTO platform_admin_staff(id,user_id,role) VALUES($1,$2,$3)',
   [staffId,userId,'admin']);
  await db.query(`INSERT INTO platform_admin_sessions
   (staff_id,token_hash,created_at,expires_at,mfa_verified_at)
   VALUES($1,$2,$3,$4,$5)`,[staffId,hashAdminSessionToken(bearer,pepper),
   new Date(now-120_000),new Date(now+900_000),new Date(now-60_000)]);
  await db.query('INSERT INTO platform_admin_totp_factors(staff_id,activated_at) VALUES($1,$2)',
   [staffId,new Date(now-120_000)]);
  await db.query('INSERT INTO platform_admin_grants(staff_id,scope) VALUES($1,$2)',
   [staffId,scope]);
  const persist=createAppealBffPgAuthorizedSessionInsert(db,{
   adminBearer:bearer,adminPepper:pepper,resourceScope:scope,now,
  });
  let accepted=0;
  async function attempt(expected:boolean,lifetimeMs=60_000){
   const tokenHash=randomBytes(32).toString('hex');
   const success=await persist(tokenHash,now+lifetimeMs);
   assert.equal(success,expected);
   const stored=await db.query<{staff_id:string;token_hash:string}>(
    'SELECT staff_id::text,token_hash FROM platform_admin_appeal_browser_sessions WHERE token_hash=$1',
    [tokenHash]);
   assert.equal(stored.rows.length,expected?1:0);
   if(expected){accepted++;assert.equal(stored.rows[0]?.staff_id,staffId);}
  }
  await attempt(true);
  await db.query('UPDATE platform_admin_sessions SET revoked_at=$1',[new Date(now-1)]);
  await attempt(false);
  await db.query('UPDATE platform_admin_sessions SET revoked_at=NULL, expires_at=$1',
   [new Date(now-1)]);
  await attempt(false);
  await db.query('UPDATE platform_admin_sessions SET expires_at=$1',[new Date(now+900_000)]);
  await attempt(false,960_000);
  await db.query('UPDATE platform_admin_sessions SET mfa_verified_at=$1',
   [new Date(now-901_000)]);
  await attempt(false);
  await db.query('UPDATE platform_admin_sessions SET mfa_verified_at=$1',
   [new Date(now-60_000)]);
  await db.query('UPDATE platform_admin_totp_factors SET disabled_at=$1',[new Date(now-1)]);
  await attempt(false);
  await db.query('UPDATE platform_admin_totp_factors SET disabled_at=NULL');
  await db.query('DELETE FROM platform_admin_grants');
  await attempt(false);
  await db.query('INSERT INTO platform_admin_grants(staff_id,scope) VALUES($1,$2)',
   [staffId,scope]);
  await db.query('UPDATE platform_admin_staff SET disabled_at=$1',[new Date(now-1)]);
  await attempt(false);
  await db.query('UPDATE platform_admin_staff SET disabled_at=NULL,role=$1',['auditor']);
  await attempt(false);
  await db.query('UPDATE platform_admin_staff SET role=$1',['admin']);
  await db.query('UPDATE users SET status=$1',['SUSPENDED']);
  await attempt(false);
  await db.query('UPDATE users SET status=$1',['ACTIVE']);
  await attempt(true);
  const all=await db.query<{count:string}>('SELECT count(*)::text AS count FROM platform_admin_appeal_browser_sessions');
  assert.equal(Number(all.rows[0]?.count),accepted);
 }finally{await db.end();}
});
