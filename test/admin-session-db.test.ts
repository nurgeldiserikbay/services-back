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
  const {token,tokenHash:hash}=issueAdminSessionToken(pepper);
  const now=Date.now();
  await db.query('INSERT INTO users(id) VALUES($1)',[userId]);
  await db.query('INSERT INTO platform_admin_staff(id,user_id,role) VALUES($1,$2,$3)',
   [staffId,userId,'auditor']);
  await db.query(`INSERT INTO platform_admin_sessions
   (id,staff_id,token_hash,created_at,mfa_verified_at,expires_at)
   VALUES($1,$2,$3,$4,$5,$6)`,
   [sessionId,staffId,hash,new Date(now-60_000),
    new Date(now-60_000),new Date(now+3600_000)]);
  await db.query('INSERT INTO platform_admin_grants(id,staff_id,scope) VALUES($1,$2,$3)',
   [grantId,staffId,scope]);
  // An admin bearer is valid only with an activated, non-disabled TOTP factor.
  await db.query(`
   INSERT INTO platform_admin_totp_factors(
    staff_id,encrypted_secret,key_version,created_at,activated_at
   ) VALUES($1,$2,$3,$4,$5)
  `,[staffId,'integration-test-placeholder-encrypted-envelope','test-v1',
   new Date(now-240_000),new Date(now-180_000)]);
  const principal=await resolvePlatformAdminSession(db,token,pepper,now);
  assert.equal(principal?.userId,userId);
  assert.deepEqual(principal?.resourceScopes,[scope]);
  // Future-dated creation is rejected by the authorization query,
  // independently of database lifetime CHECK constraints.
  await db.query('UPDATE platform_admin_sessions SET created_at=$2 WHERE id=$1',
   [sessionId,new Date(now+60_000)]);
  assert.equal(await resolvePlatformAdminSession(db,token,pepper,now),null);
  await db.query('UPDATE platform_admin_sessions SET created_at=$2 WHERE id=$1',
   [sessionId,new Date(now-60_000)]);
  assert.equal((await resolvePlatformAdminSession(db,token,pepper,now))?.userId,userId);
  assert.equal(await canAccessPlatformAdminResource(db,token,pepper,'audit.read',scope,now),true);
  assert.equal(await canAccessPlatformAdminResource(db,token,pepper,'moderation.decide',scope,now),false);
  assert.equal(await canAccessPlatformAdminResource(
   db,token,pepper,'audit.read','organization:'+randomUUID(),now),false);
  // MFA freshness has an inclusive 15-minute boundary. Preserve the
  // session and TOTP creation/activation chronology while moving the clock.
  // The session CHECK requires MFA verification no later than creation.
  // Change both timestamps in one statement to avoid an invalid intermediate row.
  await db.query('UPDATE platform_admin_sessions SET created_at=$2,mfa_verified_at=$3 WHERE id=$1',
   [sessionId,new Date(now-15*60_000),new Date(now-15*60_000)]);
  // Update factor chronology atomically: the old activation time must not
  // temporarily precede the new creation time.
  await db.query(
   'UPDATE platform_admin_totp_factors SET created_at=$2,activated_at=$3 WHERE staff_id=$1',
   [staffId,new Date(now-25*60_000),new Date(now-20*60_000)],
  );
  assert.equal((await resolvePlatformAdminSession(db,token,pepper,now))?.userId,userId);
  assert.equal(await resolvePlatformAdminSession(db,token,pepper,now+1),null);
  await db.query('UPDATE platform_admin_sessions SET created_at=$2,mfa_verified_at=$3 WHERE id=$1',
   [sessionId,new Date(now-60_000),new Date(now-60_000)]);
  // Restore activation first: moving creation to four minutes ago while
  // activation is still twenty minutes ago would violate chronology.
  await db.query('UPDATE platform_admin_totp_factors SET activated_at=$2 WHERE staff_id=$1',
   [staffId,new Date(now-180_000)]);
  await db.query('UPDATE platform_admin_totp_factors SET created_at=$2 WHERE staff_id=$1',
   [staffId,new Date(now-240_000)]);
  // Session expiry is exclusive: a token is valid just before expiry,
  // but never at the expiry timestamp, regardless of its other grants.
  // Keep MFA fresh at the boundary so the test isolates session expiry.
  await db.query('UPDATE platform_admin_sessions SET expires_at=$2 WHERE id=$1',
   [sessionId,new Date(now+120_000)]);
  assert.equal(await canAccessPlatformAdminResource(
   db,token,pepper,'audit.read',scope,now+119_999),true);
  assert.equal(await resolvePlatformAdminSession(db,token,pepper,now+120_000),null);
  await db.query('UPDATE platform_admin_sessions SET expires_at=$2 WHERE id=$1',
   [sessionId,new Date(now+3600_000)]);
  // Role changes must take effect immediately for an existing valid session.
  await db.query("UPDATE platform_admin_staff SET role='operator' WHERE id=$1",[staffId]);
  assert.equal(await canAccessPlatformAdminResource(db,token,pepper,'audit.read',scope,now),false);
  assert.equal(await canAccessPlatformAdminResource(db,token,pepper,'moderation.read',scope,now),true);
  await db.query("UPDATE platform_admin_staff SET role='auditor' WHERE id=$1",[staffId]);
  assert.equal(await canAccessPlatformAdminResource(db,token,pepper,'audit.read',scope,now),true);
  await db.query('UPDATE platform_admin_sessions SET revoked_at=now() WHERE id=$1',[sessionId]);
  assert.equal(await resolvePlatformAdminSession(db,token,pepper,now),null);
  await db.query('UPDATE platform_admin_sessions SET revoked_at=NULL WHERE id=$1',[sessionId]);
  await db.query('UPDATE platform_admin_staff SET disabled_at=now() WHERE id=$1',[staffId]);
  assert.equal(await resolvePlatformAdminSession(db,token,pepper,now),null);
  await db.query('UPDATE platform_admin_staff SET disabled_at=NULL WHERE id=$1',[staffId]);
  // MFA proof may precede session issuance, but a stale proof is denied.
  await db.query('UPDATE platform_admin_sessions SET mfa_verified_at=$2 WHERE id=$1',
   [sessionId,new Date(now-16*60_000)]);
  assert.equal(await resolvePlatformAdminSession(db,token,pepper,now),null);
  await db.query('UPDATE platform_admin_sessions SET mfa_verified_at=$2 WHERE id=$1',
   [sessionId,new Date(now-60_000)]);
  // A TOTP factor activated after MFA verification cannot back that proof.
  await db.query('UPDATE platform_admin_totp_factors SET activated_at=$2 WHERE staff_id=$1',
   [staffId,new Date(now-30_000)]);
  assert.equal(await resolvePlatformAdminSession(db,token,pepper,now),null);
  await db.query('UPDATE platform_admin_totp_factors SET activated_at=$2 WHERE staff_id=$1',
   [staffId,new Date(now-180_000)]);
  // MFA cannot be reused when the enrolled factor has been disabled.
  await db.query('UPDATE platform_admin_totp_factors SET disabled_at=now() WHERE staff_id=$1',
   [staffId]);
  assert.equal(await resolvePlatformAdminSession(db,token,pepper,now),null);
  await db.query('UPDATE platform_admin_totp_factors SET disabled_at=NULL WHERE staff_id=$1',
   [staffId]);
  assert.equal((await resolvePlatformAdminSession(db,token,pepper,now))?.userId,userId);
  // Deleting the enrolled TOTP factor must invalidate every existing
  // admin bearer, even when the session and resource grant remain live.
  await db.query('SAVEPOINT admin_factor_removal');
  await db.query('DELETE FROM platform_admin_totp_factors WHERE staff_id=$1',[staffId]);
  assert.equal(await resolvePlatformAdminSession(db,token,pepper,now),null);
  await db.query('ROLLBACK TO SAVEPOINT admin_factor_removal');
  await db.query('RELEASE SAVEPOINT admin_factor_removal');
  assert.equal((await resolvePlatformAdminSession(db,token,pepper,now))?.userId,userId);
  await db.query('DELETE FROM platform_admin_grants WHERE id=$1',[grantId]);
  assert.equal(await canAccessPlatformAdminResource(db,token,pepper,'audit.read',scope,now),false);
  await db.query('INSERT INTO platform_admin_grants(id,staff_id,scope) VALUES($1,$2,$3)',
   [grantId,staffId,scope]);
  await db.query("UPDATE users SET status='SUSPENDED' WHERE id=$1",[userId]);
  assert.equal(await resolvePlatformAdminSession(db,token,pepper,now),null);
 }finally{
  await db.query('ROLLBACK').catch(()=>{});
  await db.end();
 }
});

test('admin database rejects duplicate grants, duplicate token hashes and orphan sessions',async()=>{
 const db=new Client({connectionString:process.env.DATABASE_URL});
 await db.connect();
 try{
  await db.query('BEGIN');
  const userId=randomUUID(),staffId=randomUUID(),sessionId=randomUUID();
  const scope='organization:'+randomUUID();
  const {tokenHash:hash}=issueAdminSessionToken(randomBytes(32));
  await db.query('INSERT INTO users(id) VALUES($1)',[userId]);
  await db.query('INSERT INTO platform_admin_staff(id,user_id,role) VALUES($1,$2,$3)',
   [staffId,userId,'auditor']);
  await db.query(`INSERT INTO platform_admin_sessions
   (id,staff_id,token_hash,mfa_verified_at,expires_at)
   VALUES($1,$2,$3,now(),now()+interval '1 hour')`,
   [sessionId,staffId,hash]);
  await db.query('INSERT INTO platform_admin_grants(id,staff_id,scope) VALUES($1,$2,$3)',
   [randomUUID(),staffId,scope]);
  async function expectConstraint(sql:string,params:unknown[],code:string){
   await db.query('SAVEPOINT admin_constraint_check');
   try{
    await assert.rejects(db.query(sql,params),{code});
   }finally{
    await db.query('ROLLBACK TO SAVEPOINT admin_constraint_check');
    await db.query('RELEASE SAVEPOINT admin_constraint_check');
   }
  }
  await expectConstraint(
   'INSERT INTO platform_admin_grants(id,staff_id,scope) VALUES($1,$2,$3)',
   [randomUUID(),staffId,scope],'23505');
  await expectConstraint(
   `INSERT INTO platform_admin_sessions
    (id,staff_id,token_hash,mfa_verified_at,expires_at)
    VALUES($1,$2,$3,now(),now()+interval '1 hour')`,
   [randomUUID(),staffId,hash],'23505');
  await expectConstraint(
   `INSERT INTO platform_admin_sessions
    (id,staff_id,token_hash,mfa_verified_at,expires_at)
    VALUES($1,$2,$3,now(),now()+interval '1 hour')`,
   [randomUUID(),randomUUID(),'a'.repeat(64)],'23503');
  await expectConstraint(
   'INSERT INTO platform_admin_staff(id,user_id,role) VALUES($1,$2,$3)',
   [randomUUID(),userId,'operator'],'23505');
  await expectConstraint(
   'INSERT INTO platform_admin_staff(id,user_id,role) VALUES($1,$2,$3)',
   [randomUUID(),randomUUID(),'operator'],'23503');
  await expectConstraint(
   `INSERT INTO platform_admin_sessions
    (id,staff_id,token_hash,mfa_verified_at,expires_at)
    VALUES($1,$2,$3,now(),now()+interval '1 hour')`,
   [randomUUID(),staffId,'Z'.repeat(64)],'23514');
  await expectConstraint(
   `INSERT INTO platform_admin_sessions
    (id,staff_id,token_hash,mfa_verified_at,expires_at,created_at)
    VALUES($1,$2,$3,now(),now()-interval '1 minute',now())`,
   [randomUUID(),staffId,'b'.repeat(64)],'23514');
  await expectConstraint(
   `INSERT INTO platform_admin_sessions
    (id,staff_id,token_hash,mfa_verified_at,expires_at,created_at)
    VALUES($1,$2,$3,now()+interval '2 hours',now()+interval '1 hour',now())`,
   [randomUUID(),staffId,'c'.repeat(64)],'23514');
  await expectConstraint(
   'INSERT INTO platform_admin_grants(id,staff_id,scope) VALUES($1,$2,$3)',
   [randomUUID(),staffId,'organization:not-a-uuid'],'23514');
  await expectConstraint(
   `INSERT INTO platform_moderation_cases
    (id,resource_scope,subject_kind,state) VALUES($1,$2,$3,$4)`,
   [randomUUID(),'organization:not-a-uuid','review','triage'],'23514');
  // Use a real account so the role CHECK, not the user FK, is what fails.
  const invalidRoleUserId=randomUUID();
  await db.query('INSERT INTO users(id) VALUES($1)',[invalidRoleUserId]);
  await expectConstraint(
   'INSERT INTO platform_admin_staff(id,user_id,role) VALUES($1,$2,$3)',
   [randomUUID(),invalidRoleUserId,'superadmin'],'23514');
  await expectConstraint(
   `INSERT INTO platform_moderation_cases
    (id,resource_scope,subject_kind,state)
    VALUES($1,$2,$3,$4)`,
   [randomUUID(),scope,'private_contact','triage'],'23514');
  await expectConstraint(
   `INSERT INTO platform_moderation_cases
    (id,resource_scope,subject_kind,state)
    VALUES($1,$2,$3,$4)`,
   [randomUUID(),scope,'review','unrestricted'],'23514');
  // A valid projection remains writable after rejected values.
  const validCase=randomUUID();
  await db.query(
   `INSERT INTO platform_moderation_cases
    (id,resource_scope,subject_kind,state)
    VALUES($1,$2,$3,$4)`,
   [validCase,scope,'review','triage']);
  const saved=await db.query('SELECT state FROM platform_moderation_cases WHERE id=$1',[validCase]);
  assert.equal(saved.rows[0]?.state,'triage');
 }finally{
  await db.query('ROLLBACK').catch(()=>{});
  await db.end();
 }
});
