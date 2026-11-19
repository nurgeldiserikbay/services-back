import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomBytes,randomUUID} from 'node:crypto';
import {Client} from 'pg';
import {createAppealBffPgSessionStorage} from '../src/modules/admin/admin-professional-appeal-bff-pg-session-storage.js';
import {hashAppealBffSessionToken} from '../src/modules/admin/admin-professional-appeal-bff-session-issuance.js';

// Real PostgreSQL 16 CI integration using a connection-local TEMP table only.
// Production schema/migration is a separate gated delivery. Never touch live data.
test('real PostgreSQL hash lookup, expiry and conditional revocation',{
 skip:!process.env.DATABASE_URL,
},async()=>{
 const db=new Client({connectionString:process.env.DATABASE_URL});
 await db.connect();
 try{
  await db.query(`CREATE TEMP TABLE users(id uuid PRIMARY KEY,status text NOT NULL)`);
  await db.query(`CREATE TEMP TABLE platform_admin_staff(id uuid PRIMARY KEY,user_id uuid NOT NULL,disabled_at timestamptz)`);
  await db.query(`CREATE TEMP TABLE platform_admin_sessions(id uuid PRIMARY KEY,staff_id uuid NOT NULL,revoked_at timestamptz,expires_at timestamptz NOT NULL)`);
  await db.query(`
   CREATE TEMP TABLE platform_admin_appeal_browser_sessions(
    id uuid PRIMARY KEY, staff_id uuid NOT NULL, admin_session_id uuid NOT NULL, token_hash char(64) NOT NULL UNIQUE,
    expires_at timestamptz NOT NULL, revoked_at timestamptz
   ) ON COMMIT PRESERVE ROWS
  `);
  const storage=createAppealBffPgSessionStorage(db);
  const pepper=randomBytes(32),proof=randomBytes(32).toString('base64url');
  const tokenHash=hashAppealBffSessionToken(proof,pepper),id=randomUUID();
  const uid=randomUUID(),sid=randomUUID(),aid=randomUUID();
  await db.query('INSERT INTO users(id,status) VALUES($1,$2)',[uid,'ACTIVE']);
  await db.query('INSERT INTO platform_admin_staff(id,user_id) VALUES($1,$2)',[sid,uid]);
  await db.query("INSERT INTO platform_admin_sessions(id,staff_id,expires_at) VALUES($1,$2,now()+interval '10 minutes')",[aid,sid]);
  await db.query(`INSERT INTO platform_admin_appeal_browser_sessions
   (id,staff_id,admin_session_id,token_hash,expires_at) VALUES ($1,$2,$3,$4,now()+interval '5 minutes')`,
   [id,sid,aid,tokenHash]);
  const session=await storage.findSessionByHash(tokenHash);
  assert.equal(session?.sessionId,id);
  assert.equal(session?.revokedAt,null);
  assert.ok(session && session.expiresAt>Date.now());
  assert.equal(await storage.findSessionByHash('bad'),null);
  assert.equal(await storage.findSessionByHash('0'.repeat(64)),null);
  await db.query('UPDATE platform_admin_sessions SET revoked_at=now() WHERE id=$1',[aid]);
  assert.equal(await storage.findSessionByHash(tokenHash),null,'revoked parent invalidates browser proof');
  await db.query('UPDATE platform_admin_sessions SET revoked_at=NULL WHERE id=$1',[aid]);
  assert.ok(await storage.findSessionByHash(tokenHash),'restored parent allows lookup in test');
  await db.query("UPDATE platform_admin_sessions SET expires_at=now()-interval '1 second' WHERE id=$1",[aid]);
  assert.equal(await storage.findSessionByHash(tokenHash),null,'expired parent invalidates browser proof');
  await db.query("UPDATE platform_admin_sessions SET expires_at=now()+interval '10 minutes' WHERE id=$1",[aid]);
  assert.equal(await storage.revokeSessionByHash(tokenHash),true);
  assert.equal(await storage.revokeSessionByHash(tokenHash),false,'second revoke cannot succeed');
  assert.equal(await storage.findSessionByHash(tokenHash),null,'revoked session denied');
  assert.equal(await storage.revokeSessionByHash('bad'),false);
  const expired=randomBytes(32).toString('hex');
  await db.query(`INSERT INTO platform_admin_appeal_browser_sessions
   (id,staff_id,admin_session_id,token_hash,expires_at) VALUES ($1,$2,$3,$4,now()-interval '1 second')`,
   [randomUUID(),sid,aid,expired]);
  assert.equal(await storage.findSessionByHash(expired),null);
  assert.equal(await storage.revokeSessionByHash(expired),false);
 }finally{await db.end();}
});

test('real PostgreSQL concurrent conditional revocation produces one winner',{
 skip:!process.env.DATABASE_URL,
},async()=>{
 const db=new Client({connectionString:process.env.DATABASE_URL});
 await db.connect();
 try{
  await db.query(`CREATE TEMP TABLE platform_admin_appeal_browser_sessions(
   id uuid PRIMARY KEY,staff_id uuid NOT NULL,admin_session_id uuid NOT NULL,token_hash char(64) UNIQUE NOT NULL,
   expires_at timestamptz NOT NULL,revoked_at timestamptz
  )`);
  const id=randomUUID(),hash=randomBytes(32).toString('hex');
  await db.query(`INSERT INTO platform_admin_appeal_browser_sessions
   (id,staff_id,admin_session_id,token_hash,expires_at) VALUES($1,$2,$3,$4,now()+interval '1 minute')`,[id,randomUUID(),randomUUID(),hash]);
  const store=createAppealBffPgSessionStorage(db);
  const values=await Promise.all(Array.from({length:8},()=>store.revokeSessionByHash(hash)));
  assert.equal(values.filter(Boolean).length,1);
  assert.equal(await store.findSessionByHash(hash),null);
 }finally{await db.end();}
});
