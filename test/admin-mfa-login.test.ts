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
const primary={staffId,authenticatedAt:now-1000};

function fixture(mode:'ok'|'disabled'|'bad-code'|'commit-fails'){
 const events:string[]=[];
 const client={
  query:async(sql:string)=>{
   if(['BEGIN','COMMIT','ROLLBACK'].includes(sql)){
    events.push(sql);
    if(sql==='COMMIT'&&mode==='commit-fails')throw Error('commit failed');
    return {rows:[]};
   }
   if(sql.includes('pg_advisory_xact_lock')){events.push('staff-lock');return {rows:[{}]};}
   if(sql.includes('FROM platform_admin_mfa_attempts')){
    events.push('lockout');return {rows:[]};
   }
   if(sql.includes('FOR SHARE OF factor')){
    events.push('factor-lock');
    return {rows:mode==='disabled'?[]:[{staff_id:staffId}]};
   }
   if(sql.includes('factor.encrypted_secret')){
    events.push('load-factor');
    return {rows:[{encrypted_secret:envelope,key_version:'key-1'}]};
   }
   if(sql.includes('platform_admin_totp_replay')){
    events.push('consume');
    return {rows:[{last_consumed_counter:String(now/30000)}]};
   }
   if(sql.includes('INSERT INTO platform_admin_mfa_attempts')){
    events.push('failure');return {rows:[{failed_attempts:1,locked_until:null}]};
   }
   if(sql.includes('DELETE FROM platform_admin_mfa_attempts')){
    events.push('clear-failures');return {rows:[]};
   }
   if(sql.includes('INSERT INTO platform_admin_sessions')){
    events.push('session');return {rows:[{id:randomUUID()}]};
   }
   throw Error('unexpected SQL');
  },
  release:()=>events.push('release'),
 };
 return {pool:{connect:async()=>client} as never,events};
}
test('admin login locks factor and commits before returning bearer',async()=>{
 const f=fixture('ok');
 const result=await loginAdminWithProvisionedTotp(
  f.pool,primary,code,async()=>key,pepper,now,
 );
 assert.ok(result?.token);
 assert.deepEqual(f.events,[
  'BEGIN','staff-lock','lockout','factor-lock','load-factor',
  'consume','session','clear-failures','COMMIT','release',
 ]);
});
test('disabled factor never loads secret or issues session',async()=>{
 const f=fixture('disabled');
 assert.equal(await loginAdminWithProvisionedTotp(
  f.pool,primary,code,async()=>key,pepper,now,
 ),null);
 assert.deepEqual(f.events,[
  'BEGIN','staff-lock','lockout','factor-lock','ROLLBACK','release',
 ]);
});
test('invalid TOTP commits a failure without creating a session',async()=>{
 const f=fixture('bad-code');
 const bad=code==='999999'?'000000':'999999';
 assert.equal(await loginAdminWithProvisionedTotp(
  f.pool,primary,bad,async()=>key,pepper,now,
 ),null);
 assert.deepEqual(f.events,[
  'BEGIN','staff-lock','lockout','factor-lock','load-factor',
  'failure','COMMIT','release',
 ]);
});
test('commit failure never releases a bearer',async()=>{
 const f=fixture('commit-fails');
 await assert.rejects(loginAdminWithProvisionedTotp(
  f.pool,primary,code,async()=>key,pepper,now,
 ),/commit failed/);
 assert.equal(f.events.at(-1),'release');
 assert.ok(f.events.includes('ROLLBACK'));
});

test('malformed MFA code is counted after a valid primary assertion',async()=>{
 const f=fixture('bad-code');
 assert.equal(await loginAdminWithProvisionedTotp(
  f.pool,primary,'12x',async()=>key,pepper,now,
 ),null);
 assert.deepEqual(f.events,[
  'BEGIN','staff-lock','lockout','factor-lock','load-factor',
  'failure','COMMIT','release',
 ]);
});
