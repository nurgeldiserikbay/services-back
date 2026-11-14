import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHmac,randomBytes,randomUUID} from 'node:crypto';
import {sealAdminTotpSecret} from '../src/modules/admin/admin-totp-secret.js';
import {loginAdminWithProvisionedTotp} from '../src/modules/admin/admin-mfa-login.js';

test('audit outage rolls back privileged session and consumed TOTP replay',async()=>{
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
 const events:string[]=[];
 const releases:unknown[]=[];
 const client={
  query:async(sql:string)=>{
   if(sql==='BEGIN'||sql==='ROLLBACK'||sql.startsWith('SET LOCAL ')){
    events.push(sql);return {rows:[]};
   }
   if(sql.includes('pg_advisory_xact_lock'))return {rows:[{}]};
   if(sql.trimStart().startsWith('SELECT locked_until,failed_attempts,window_started_at'))
    return {rows:[]};
   if(sql.includes('factor.encrypted_secret'))
    return {rows:[{encrypted_secret:envelope,key_version:'key-1'}]};
   if(sql.includes('FOR SHARE OF factor'))return {rows:[{staff_id:staffId}]};
   if(sql.includes('INSERT INTO platform_admin_totp_replay')){
    events.push('replay');return {rows:[{last_consumed_counter:String(now/30000)}]};
   }
   if(sql.includes('INSERT INTO platform_admin_sessions')){
    events.push('session');return {rows:[{id:randomUUID()}]};
   }
   if(sql.includes('DELETE FROM platform_admin_mfa_attempts')){
    events.push('clear-failures');return {rows:[]};
   }
   if(sql.includes('INSERT INTO platform_admin_security_events')){
    events.push('audit-error');throw Error('audit database unavailable');
   }
   throw Error('unexpected SQL');
  },
  release:(error?:unknown)=>releases.push(error),
 };
 await assert.rejects(loginAdminWithProvisionedTotp(
  {connect:async()=>client} as never,
  {staffId,authenticatedAt:now-1000},code,async()=>key,pepper,now,
 ),/audit database unavailable/);
 assert.deepEqual(events.slice(-5),[
  'replay','session','clear-failures','audit-error','ROLLBACK',
 ]);
 assert.ok(!events.includes('COMMIT'));
 assert.deepEqual(releases,[undefined]);
});
