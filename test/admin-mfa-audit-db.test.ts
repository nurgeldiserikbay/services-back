import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {Client} from 'pg';
import {recordAdminMfaSecurityEvent} from '../src/modules/admin/admin-mfa-security-audit.js';

test('PostgreSQL rolls back privileged MFA audit and related writes together',async()=>{
 const db=new Client({connectionString:process.env.DATABASE_URL});
 await db.connect();
 const userId=randomUUID(),staffId=randomUUID();
 try{
  await db.query('BEGIN');
  await db.query('INSERT INTO users(id) VALUES($1)',[userId]);
  await db.query(
   "INSERT INTO platform_admin_staff(id,user_id,role) VALUES($1,$2,'auditor')",
   [staffId,userId],
  );
  await recordAdminMfaSecurityEvent(db,staffId,'admin_mfa_login_failed');
  const inside=await db.query(
   "SELECT count(*)::int AS count FROM platform_admin_security_events WHERE actor_staff_id=$1 AND action='admin_mfa_login_failed'",
   [staffId],
  );
  assert.equal(inside.rows[0]?.count,1);
  await db.query('ROLLBACK');
  const audit=await db.query(
   'SELECT count(*)::int AS count FROM platform_admin_security_events WHERE actor_staff_id=$1',
   [staffId],
  );
  const staff=await db.query(
   'SELECT count(*)::int AS count FROM platform_admin_staff WHERE id=$1',
   [staffId],
  );
  assert.equal(audit.rows[0]?.count,0);
  assert.equal(staff.rows[0]?.count,0);
 }finally{
  await db.query('ROLLBACK').catch(()=>{});
  await db.end();
 }
});
