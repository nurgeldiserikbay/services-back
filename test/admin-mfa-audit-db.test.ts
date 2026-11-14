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


test('PostgreSQL refuses mutation of privileged audit rows within a transaction',async()=>{
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
  for(const sql of [
   'DELETE FROM platform_admin_security_events WHERE actor_staff_id=$1',
   "UPDATE platform_admin_security_events SET action='admin_mfa_login_succeeded' WHERE actor_staff_id=$1",
  ]){
   await db.query('SAVEPOINT immutable_audit');
   try{
    await assert.rejects(db.query(sql,[staffId]),{code:'55000'});
   }finally{
    await db.query('ROLLBACK TO SAVEPOINT immutable_audit');
    await db.query('RELEASE SAVEPOINT immutable_audit');
   }
  }
  const result=await db.query(
   'SELECT action FROM platform_admin_security_events WHERE actor_staff_id=$1',
   [staffId],
  );
  assert.deepEqual(result.rows.map(row=>row.action),['admin_mfa_login_failed']);
 }finally{
  await db.query('ROLLBACK').catch(()=>{});
  await db.end();
 }
});

test('PostgreSQL accepts every supported MFA audit action and rejects unknown actions',async()=>{
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
  const actions=[
   'totp_factor_activated',
   'totp_activation_failed',
   'admin_mfa_login_succeeded',
   'admin_mfa_login_failed',
  ];
  for(const action of actions){
   await recordAdminMfaSecurityEvent(db,staffId,action);
  }
  const result=await db.query(
   'SELECT action FROM platform_admin_security_events WHERE actor_staff_id=$1 ORDER BY action',
   [staffId],
  );
  assert.deepEqual(result.rows.map(row=>row.action),[...actions].sort());
  await db.query('SAVEPOINT rejected_action');
  try{
   await assert.rejects(
    db.query(
     'INSERT INTO platform_admin_security_events (actor_staff_id,target_staff_id,action) VALUES ($1,$1,$2)',
     [staffId,'unexpected_admin_mfa_action'],
    ),
    {code:'23514'},
   );
  }finally{
   await db.query('ROLLBACK TO SAVEPOINT rejected_action');
   await db.query('RELEASE SAVEPOINT rejected_action');
  }
 }finally{
  await db.query('ROLLBACK').catch(()=>{});
  await db.end();
 }
});


test('PostgreSQL rejects orphaned privileged audit events without creating rows',async()=>{
 const db=new Client({connectionString:process.env.DATABASE_URL});
 await db.connect();
 const absentStaffId=randomUUID();
 try{
  await db.query('BEGIN');
  await assert.rejects(
   recordAdminMfaSecurityEvent(db,absentStaffId,'admin_mfa_login_failed'),
   {code:'23503'},
  );
  await db.query('ROLLBACK');
  const result=await db.query(
   'SELECT count(*)::int AS count FROM platform_admin_security_events WHERE actor_staff_id=$1',
   [absentStaffId],
  );
  assert.equal(result.rows[0]?.count,0);
 }finally{
  await db.query('ROLLBACK').catch(()=>{});
  await db.end();
 }
});


test('MFA audit writer rejects malformed identifiers and actions before SQL',async()=>{
 let queries=0;
 const db={query:async()=>{queries++;throw new Error('unexpected SQL');}} as never;
 const validStaffId=randomUUID();
 for(const [staffId,action] of [
  ['not-a-uuid','admin_mfa_login_failed'],
  [validStaffId,'unexpected_admin_mfa_action'],
  [validStaffId,'totp_factor_revoked'],
  ['', 'admin_mfa_login_succeeded'],
 ]){
  await assert.rejects(
   recordAdminMfaSecurityEvent(db,staffId,action),
   /invalid_admin_mfa_audit_event/,
  );
 }
 assert.equal(queries,0);
});


test('MFA audit writer fails closed when INSERT does not confirm exactly one event',async()=>{
 const staffId=randomUUID();
 for(const rows of [
  [],
  [{}],
  [{id:'not-a-uuid'}],
  [{id:randomUUID()},{id:randomUUID()}],
 ]){
  let queries=0;
  const db={query:async()=>{queries++;return {rows};}} as never;
  await assert.rejects(
   recordAdminMfaSecurityEvent(db,staffId,'admin_mfa_login_failed'),
   /admin_mfa_audit_unavailable/,
  );
  assert.equal(queries,1);
 }
});
