import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHmac,randomBytes,randomUUID} from 'node:crypto';
import {sealAdminTotpSecret} from '../src/modules/admin/admin-totp-secret.js';
import {loginAdminWithProvisionedTotp} from '../src/modules/admin/admin-mfa-login.js';

const staffId=randomUUID();
const secret=randomBytes(32);
const key=randomBytes(32);
const pepper=randomBytes(32);
const now=123456*30000;
const input=Buffer.alloc(8);
input.writeBigUInt64BE(BigInt(now/30000));
const digest=createHmac('sha1',secret).update(input).digest();
const offset=digest[digest.length-1]!&15;
const code=String((digest.readUInt32BE(offset)&0x7fffffff)%1_000_000).padStart(6,'0');
const envelope=sealAdminTotpSecret(secret,staffId,key);

test('successful TOTP cannot issue bearer if mandatory security audit fails',async()=>{
 const statements:string[]=[];
 const releases:unknown[]=[];
 const client={
  query:async(sql:string)=>{
   if(sql==='BEGIN'||sql==='ROLLBACK'||sql.startsWith('SET LOCAL ')){
    statements.push(sql);return {rows:[]};
   }
   if(sql.includes('pg_advisory_xact_lock'))return {rows:[{}]};
   if(sql.includes('DELETE FROM platform_admin_mfa_attempts'))return {rows:[]};
   if(sql.trimStart().startsWith('SELECT locked_until,failed_attempts,window_started_at'))return {rows:[]};
   if(sql.includes('FOR SHARE OF factor')&&sql.includes('SELECT factor.staff_id::text'))return {rows:[{staff_id:staffId}]};
   if(sql.includes('factor.encrypted_secret'))
    return {rows:[{encrypted_secret:envelope,key_version:'key-1'}]};
   if(sql.includes('platform_admin_totp_replay'))
    return {rows:[{last_consumed_counter:String(now/30000)}]};
   if(sql.includes('INSERT INTO platform_admin_sessions')){
    statements.push('session-insert');
    return {rows:[{id:randomUUID()}]};
   }
   if(sql.includes('INSERT INTO platform_admin_security_events')){
    statements.push('audit-failed');
    throw Error('audit database unavailable');
   }
   if(sql==='COMMIT'){statements.push('COMMIT');return {rows:[]};}
   throw Error('unexpected SQL');
  },
  release:(error?:unknown)=>releases.push(error),
 };
 await assert.rejects(loginAdminWithProvisionedTotp(
  {connect:async()=>client} as never,
  {staffId,authenticatedAt:now-1000},
  code,async()=>key,pepper,now,
 ),/audit database unavailable/);
 assert.ok(statements.includes('session-insert'));
 assert.ok(statements.indexOf('session-insert')<statements.indexOf('audit-failed'));
 assert.ok(statements.includes('audit-failed'));
 assert.ok(statements.includes('ROLLBACK'));
 assert.ok(!statements.includes('COMMIT'));
 assert.deepEqual(releases,[undefined]);
});


test('failed TOTP cannot commit its lockout counter without a durable audit event',async()=>{
 const statements:string[]=[];
 const releases:unknown[]=[];
 const client={
  query:async(sql:string)=>{
   if(sql==='BEGIN'||sql==='ROLLBACK'||sql.startsWith('SET LOCAL ')){
    statements.push(sql);return {rows:[]};
   }
   if(sql.includes('pg_advisory_xact_lock'))return {rows:[{}]};
   if(sql.trimStart().startsWith('SELECT locked_until,failed_attempts,window_started_at'))return {rows:[]};
   if(sql.includes('FOR SHARE OF factor')&&sql.includes('SELECT factor.staff_id::text'))return {rows:[{staff_id:staffId}]};
   if(sql.includes('factor.encrypted_secret'))
    return {rows:[{encrypted_secret:envelope,key_version:'key-1'}]};
   if(sql.includes('INSERT INTO platform_admin_sessions'))
    throw Error('invalid TOTP must not issue a session');
   if(sql.includes('INSERT INTO platform_admin_mfa_attempts')){
    statements.push('failure-counter');
    return {rows:[{failed_attempts:1,locked_until:null}]};
   }
   if(sql.includes('INSERT INTO platform_admin_security_events')){
    statements.push('audit-failed');
    return {rows:[]};
   }
   if(sql==='COMMIT'){statements.push('COMMIT');return {rows:[]};}
   throw Error('unexpected SQL');
  },
  release:(error?:unknown)=>releases.push(error),
 };
 const invalidCode=code==='999999'?'000000':'999999';
 await assert.rejects(loginAdminWithProvisionedTotp(
  {connect:async()=>client} as never,
  {staffId,authenticatedAt:now-1000},
  invalidCode,async()=>key,pepper,now,
 ),/admin_mfa_audit_unavailable/);
 assert.ok(statements.includes('failure-counter'));
 assert.ok(statements.includes('audit-failed'));
 assert.ok(statements.indexOf('failure-counter')<statements.indexOf('audit-failed'));
 assert.ok(statements.includes('ROLLBACK'));
 assert.ok(!statements.includes('COMMIT'));
 assert.deepEqual(releases,[undefined]);
});
