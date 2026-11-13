import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {recordAdminMfaSecurityEvent} from '../src/modules/admin/admin-mfa-security-audit.js';

const staffId=randomUUID();
test('audit writes only allowlisted metadata without secrets',async()=>{
 let calls=0;
 const db={query:async(sql:string,params:unknown[])=>{
  calls++;
  assert.match(sql,/INSERT INTO platform_admin_security_events/);
  assert.deepEqual(params,[staffId,'admin_mfa_login_succeeded']);
  return {rows:[{id:randomUUID()}]};
 }} as never;
 await recordAdminMfaSecurityEvent(db,staffId,'admin_mfa_login_succeeded');
 assert.equal(calls,1);
});
test('audit rejects unknown events before database access',async()=>{
 let calls=0;
 const db={query:async()=>{calls++;return {rows:[]};}} as never;
 for(const action of ['totp_factor_revoked','admin_mfa_login_succeeded; DROP TABLE users','']){
  await assert.rejects(recordAdminMfaSecurityEvent(db,staffId,action),
   /invalid_admin_mfa_audit_event/);
 }
 await assert.rejects(recordAdminMfaSecurityEvent(db,'bad','admin_mfa_login_failed'),
  /invalid_admin_mfa_audit_event/);
 assert.equal(calls,0);
});
test('audit persistence failure rejects the transaction',async()=>{
 const db={query:async()=>({rows:[]})} as never;
 await assert.rejects(recordAdminMfaSecurityEvent(db,staffId,'totp_activation_failed'),
  /admin_mfa_audit_unavailable/);
});
