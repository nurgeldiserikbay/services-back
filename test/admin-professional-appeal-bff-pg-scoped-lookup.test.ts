import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomBytes,randomUUID} from 'node:crypto';
import {Client} from 'pg';
import {createAppealBffPgScopedSessionLookup} from '../src/modules/admin/admin-professional-appeal-bff-pg-scoped-lookup.js';

test('real PostgreSQL scoped BFF lookup rechecks parent MFA, TOTP and grant on every use',{
 skip:!process.env.DATABASE_URL,
},async()=>{
 const db=new Client({connectionString:process.env.DATABASE_URL});
 await db.connect();
 try{
  await db.query('CREATE TEMP TABLE users(id uuid PRIMARY KEY,status text NOT NULL)');
  await db.query(`CREATE TEMP TABLE platform_admin_staff(
   id uuid PRIMARY KEY,user_id uuid NOT NULL,role text NOT NULL,disabled_at timestamptz)`);
  await db.query(`CREATE TEMP TABLE platform_admin_sessions(
   id uuid PRIMARY KEY,staff_id uuid NOT NULL,created_at timestamptz NOT NULL,
   expires_at timestamptz NOT NULL,revoked_at timestamptz,mfa_verified_at timestamptz NOT NULL)`);
  await db.query(`CREATE TEMP TABLE platform_admin_totp_factors(
   staff_id uuid NOT NULL,activated_at timestamptz,disabled_at timestamptz)`);
  await db.query('CREATE TEMP TABLE platform_admin_grants(staff_id uuid NOT NULL,scope text NOT NULL)');
  await db.query(`CREATE TEMP TABLE platform_admin_appeal_browser_sessions(
   id uuid PRIMARY KEY,staff_id uuid NOT NULL,admin_session_id uuid NOT NULL,
   token_hash char(64) UNIQUE NOT NULL,expires_at timestamptz NOT NULL,revoked_at timestamptz)`);
  const userId=randomUUID(),staffId=randomUUID(),parentId=randomUUID(),browserId=randomUUID();
  const hash=randomBytes(32).toString('hex'),scope='professional:'+randomUUID();
  await db.query('INSERT INTO users(id,status) VALUES($1,$2)',[userId,'ACTIVE']);
  await db.query(`INSERT INTO platform_admin_staff(id,user_id,role) VALUES($1,$2,'admin')`,[staffId,userId]);
  await db.query(`INSERT INTO platform_admin_sessions
   (id,staff_id,created_at,expires_at,mfa_verified_at)
   VALUES($1,$2,now()-interval '10 minutes',now()+interval '30 minutes',now()-interval '1 minute')`,
   [parentId,staffId]);
  await db.query(`INSERT INTO platform_admin_totp_factors(staff_id,activated_at)
   VALUES($1,now()-interval '2 minutes')`,[staffId]);
  await db.query('INSERT INTO platform_admin_grants(staff_id,scope) VALUES($1,$2)',[staffId,scope]);
  await db.query(`INSERT INTO platform_admin_appeal_browser_sessions
   (id,staff_id,admin_session_id,token_hash,expires_at)
   VALUES($1,$2,$3,$4,now()+interval '10 minutes')`,[browserId,staffId,parentId,hash]);
  const lookup=createAppealBffPgScopedSessionLookup(db);
  const valid=await lookup(hash,scope);
  assert.equal(valid?.sessionId,browserId);
  assert.equal(valid?.revokedAt,null);
  assert.ok(valid?.expiresAt&&valid.expiresAt>Date.now());
  assert.equal(await lookup('invalid',scope),null);
  assert.equal(await lookup(hash,'bad'),null);
  assert.equal(await lookup(hash,'professional:'+randomUUID()),null);
  await db.query('DELETE FROM platform_admin_grants WHERE staff_id=$1',[staffId]);
  assert.equal(await lookup(hash,scope),null,'grant removal takes effect on the next lookup');
  await db.query('INSERT INTO platform_admin_grants(staff_id,scope) VALUES($1,$2)',[staffId,scope]);
  await db.query(`UPDATE platform_admin_sessions SET mfa_verified_at=now()-interval '16 minutes' WHERE id=$1`,[parentId]);
  assert.equal(await lookup(hash,scope),null,'stale MFA cannot authorize BFF');
  await db.query(`UPDATE platform_admin_sessions SET mfa_verified_at=now()-interval '1 minute' WHERE id=$1`,[parentId]);
  await db.query('UPDATE platform_admin_totp_factors SET disabled_at=now() WHERE staff_id=$1',[staffId]);
  assert.equal(await lookup(hash,scope),null,'disabled TOTP denies access');
  await db.query('UPDATE platform_admin_totp_factors SET disabled_at=NULL WHERE staff_id=$1',[staffId]);
  await db.query(`UPDATE platform_admin_staff SET role='auditor' WHERE id=$1`,[staffId]);
  assert.equal(await lookup(hash,scope),null,'auditor has no appeal decision privilege');
  await db.query(`UPDATE platform_admin_staff SET role='admin' WHERE id=$1`,[staffId]);
  await db.query('UPDATE platform_admin_sessions SET revoked_at=now() WHERE id=$1',[parentId]);
  assert.equal(await lookup(hash,scope),null,'revoked parent denies previously issued BFF cookie');
  await db.query('UPDATE platform_admin_sessions SET revoked_at=NULL WHERE id=$1',[parentId]);
  await db.query('UPDATE platform_admin_appeal_browser_sessions SET revoked_at=now() WHERE id=$1',[browserId]);
  assert.equal(await lookup(hash,scope),null,'revoked browser session denies access');
 }finally{await db.end();}
});

test('scoped browser session lookup rejects malformed arguments before touching SQL',async()=>{
 let queries=0;
 const db={query:async()=>{queries++;return {rows:[]};}};
 const lookup=createAppealBffPgScopedSessionLookup(db as never);
 for(const [hash,scope] of [
  [null,'professional:'+randomUUID()],
  ['a'.repeat(64),'unknown'],
  [randomBytes(32).toString('hex'),null],
  ['b'.repeat(63),'professional:'+randomUUID()],
 ]){
  assert.equal(await lookup(hash,scope),null);
 }
 assert.equal(queries,0);
});
