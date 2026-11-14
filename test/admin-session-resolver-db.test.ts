import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {Client} from 'pg';
import {issueAdminSessionToken} from '../src/modules/admin/admin-session-token.js';
import {
 canAccessPlatformAdminResource,resolvePlatformAdminSession,
} from '../src/modules/admin/admin-session-resolver.js';

/**
 * Exercises the real migration and current revocation state in PostgreSQL.
 * The test rolls back every row and never provisions production admin staff.
 */
test('dedicated platform admin session and grants are enforced in PostgreSQL',async()=>{
 const db=new Client({connectionString:process.env.DATABASE_URL});
 await db.connect();
 try{
  await db.query('BEGIN');
  const userId=randomUUID(),staffId=randomUUID(),sessionId=randomUUID();
  const grantId=randomUUID(),scope='organization:'+randomUUID();
  const pepper=randomBytes(32),{token,tokenHash}=issueAdminSessionToken(pepper);
  await db.query('INSERT INTO users(id) VALUES($1)',[userId]);
  await db.query(
   "INSERT INTO platform_admin_staff(id,user_id,role) VALUES($1,$2,'auditor')",
   [staffId,userId],
  );
  await db.query(`
   INSERT INTO platform_admin_sessions(
    id,staff_id,token_hash,mfa_verified_at,expires_at
   ) VALUES($1,$2,$3,now(),now()+interval '1 hour')
  `,[sessionId,staffId,tokenHash]);
  await db.query(
   'INSERT INTO platform_admin_grants(id,staff_id,scope) VALUES($1,$2,$3)',
   [grantId,staffId,scope],
  );
  // Even a valid token and grant cannot bypass MFA enrollment.
  assert.equal(await resolvePlatformAdminSession(db,token,pepper),null);
  // A live admin session must be backed by a currently activated TOTP factor.
  await db.query(`
   INSERT INTO platform_admin_totp_factors(
    staff_id,encrypted_secret,key_version,activated_at
   ) VALUES($1,$2,$3,now()-interval '1 minute')
  `,[staffId,'integration-test-placeholder','test-v1']);
  assert.equal(await canAccessPlatformAdminResource(
   db,token,pepper,'audit.read',scope),true);
  assert.equal(await canAccessPlatformAdminResource(
   db,token,pepper,'moderation.decide',scope),false);
  assert.equal(await canAccessPlatformAdminResource(
   db,token,pepper,'audit.read','organization:'+randomUUID()),false);

  // Revoking the only resource grant must immediately deny access.
  await db.query('DELETE FROM platform_admin_grants WHERE id=$1',[grantId]);
  assert.equal(await canAccessPlatformAdminResource(
   db,token,pepper,'audit.read',scope),false);
  await db.query(
   'INSERT INTO platform_admin_grants(id,staff_id,scope) VALUES($1,$2,$3)',
   [grantId,staffId,scope],
  );
  assert.equal(await canAccessPlatformAdminResource(
   db,token,pepper,'audit.read',scope),true);

  await db.query(
   'UPDATE platform_admin_totp_factors SET disabled_at=now() WHERE staff_id=$1',
   [staffId],
  );
  assert.equal(await resolvePlatformAdminSession(db,token,pepper),null);
  await db.query(
   'UPDATE platform_admin_totp_factors SET disabled_at=NULL WHERE staff_id=$1',
   [staffId],
  );
  assert.equal(await canAccessPlatformAdminResource(
   db,token,pepper,'audit.read',scope),true);
  // Reprovisioning after MFA verification must invalidate the older bearer.
  await db.query(
   "UPDATE platform_admin_totp_factors SET activated_at=now()+interval '1 second' WHERE staff_id=$1",
   [staffId],
  );
  assert.equal(await resolvePlatformAdminSession(db,token,pepper),null);
  await db.query(
   "UPDATE platform_admin_totp_factors SET activated_at=now()-interval '1 minute' WHERE staff_id=$1",
   [staffId],
  );
  assert.equal(await canAccessPlatformAdminResource(
   db,token,pepper,'audit.read',scope),true);

  await db.query(
   'UPDATE platform_admin_sessions SET revoked_at=now() WHERE id=$1',
   [sessionId],
  );
  assert.equal(await resolvePlatformAdminSession(db,token,pepper),null);
  await db.query(
   'UPDATE platform_admin_sessions SET revoked_at=NULL WHERE id=$1',
   [sessionId],
  );
  await db.query('UPDATE platform_admin_staff SET disabled_at=now() WHERE id=$1',[staffId]);
  assert.equal(await resolvePlatformAdminSession(db,token,pepper),null);
  await db.query('UPDATE platform_admin_staff SET disabled_at=NULL WHERE id=$1',[staffId]);
  await db.query(
   "UPDATE platform_admin_sessions SET mfa_verified_at=now()-interval '20 minutes' WHERE id=$1",
   [sessionId],
  );
  assert.equal(await canAccessPlatformAdminResource(
   db,token,pepper,'audit.read',scope),false);
 }finally{
  await db.query('ROLLBACK').catch(()=>{});
  await db.end();
 }
});
