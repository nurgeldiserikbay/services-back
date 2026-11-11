import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {Client} from 'pg';
import {issueAdminSessionToken} from '../src/modules/admin/admin-session-token.js';
import {resolvePlatformAdminSession,canAccessPlatformAdminResource} from '../src/modules/admin/admin-session-resolver.js';

test('migrated admin session grants are checked against live DB revocation and MFA',async()=>{
 const db=new Client({connectionString:process.env.DATABASE_URL});
 await db.connect();
 try{
  await db.query('BEGIN');
  const userId=randomUUID(),staffId=randomUUID(),sessionId=randomUUID(),grantId=randomUUID();
  const scope='organization:'+randomUUID();
  const pepper=randomBytes(32);
  const {token,hash}=issueAdminSessionToken(pepper);
  const now=Date.now();
  await db.query('INSERT INTO users(id) VALUES($1)',[userId]);
  await db.query('INSERT INTO platform_admin_staff(id,user_id,role) VALUES($1,$2,$3)',
   [staffId,userId,'auditor']);
  await db.query(`INSERT INTO platform_admin_sessions
   (id,staff_id,token_hash,mfa_verified_at,expires_at)
   VALUES($1,$2,$3,$4,$5)`,
   [sessionId,staffId,hash,new Date(now-60_000),new Date(now+3600_000)]);
  await db.query('INSERT INTO platform_admin_grants(id,staff_id,scope) VALUES($1,$2,$3)',
   [grantId,staffId,scope]);
  const principal=await resolvePlatformAdminSession(db,token,pepper,now);
  assert.equal(principal?.userId,userId);
  assert.deepEqual(principal?.resourceScopes,[scope]);
  assert.equal(await canAccessPlatformAdminResource(db,token,pepper,'audit.read',scope,now),true);
  assert.equal(await canAccessPlatformAdminResource(db,token,pepper,'moderation.decide',scope,now),false);
  assert.equal(await canAccessPlatformAdminResource(
   db,token,pepper,'audit.read','organization:'+randomUUID(),now),false);
  await db.query('UPDATE platform_admin_sessions SET revoked_at=now() WHERE id=$1',[sessionId]);
  assert.equal(await resolvePlatformAdminSession(db,token,pepper,now),null);
  await db.query('UPDATE platform_admin_sessions SET revoked_at=NULL WHERE id=$1',[sessionId]);
  await db.query('UPDATE platform_admin_staff SET disabled_at=now() WHERE id=$1',[staffId]);
  assert.equal(await resolvePlatformAdminSession(db,token,pepper,now),null);
  await db.query('UPDATE platform_admin_staff SET disabled_at=NULL WHERE id=$1',[staffId]);
  await db.query("UPDATE users SET status='SUSPENDED' WHERE id=$1",[userId]);
  assert.equal(await resolvePlatformAdminSession(db,token,pepper,now),null);
 }finally{
  await db.query('ROLLBACK').catch(()=>{});
  await db.end();
 }
});
