import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHmac,randomBytes,randomUUID} from 'node:crypto';
import {sealAdminTotpSecret} from '../src/modules/admin/admin-totp-secret.js';
import {activateAdminTotpInTransaction} from '../src/modules/admin/admin-totp-activation-transaction.js';

const staffId=randomUUID();
const key=randomBytes(32);
const secret=randomBytes(32);
const now=123456*30000;
const input=Buffer.alloc(8);
input.writeBigUInt64BE(BigInt(now/30000));
const digest=createHmac('sha1',secret).update(input).digest();
const offset=digest[digest.length-1]!&15;
const code=String((digest.readUInt32BE(offset)&0x7fffffff)%1000000).padStart(6,'0');
const envelope=sealAdminTotpSecret(secret,staffId,key);

function fixture(locked=false){
 const events:string[]=[];
 const client={
  query:async(sql:string)=>{
   if(['BEGIN','COMMIT','ROLLBACK'].includes(sql)){
    events.push(sql);return {rows:[]};
   }
   if(sql.includes('pg_advisory_xact_lock')){
    events.push('serialize');return {rows:[{}]};
   }
   if(sql.includes('FROM platform_admin_mfa_attempts')){
    events.push('lockout');return {rows:locked?[{locked_until:new Date(now+60000)}]:[]};
   }
   if(sql.includes('FOR UPDATE OF factor')){
    events.push('factor');return {rows:[{encrypted_secret:envelope,key_version:'key-1'}]};
   }
   if(sql.includes('platform_admin_totp_replay')){
    events.push('consume');return {rows:[{last_consumed_counter:String(now/30000)}]};
   }
   if(sql.includes('UPDATE platform_admin_totp_factors')){
    events.push('activate');return {rows:[{staff_id:staffId}]};
   }
   if(sql.includes('INSERT INTO platform_admin_mfa_attempts')){
    events.push('failure');return {rows:[{failed_attempts:1,locked_until:null}]};
   }
   if(sql.includes('DELETE FROM platform_admin_mfa_attempts')){
    events.push('reset');return {rows:[]};
   }
   throw Error('unexpected query');
  },
  release:()=>events.push('release'),
 };
 return {pool:{connect:async()=>client} as never,events};
}

test('valid enrollment proof commits replay watermark, activation and reset',async()=>{
 const f=fixture();
 assert.equal(await activateAdminTotpInTransaction(
  f.pool,staffId,code,async()=>key,now,
 ),true);
 assert.deepEqual(f.events,[
  'BEGIN','serialize','lockout','factor','consume','activate','reset','COMMIT','release',
 ]);
});
test('bad enrollment code commits a failure without activating',async()=>{
 const f=fixture();
 assert.equal(await activateAdminTotpInTransaction(
  f.pool,staffId,code==='999999'?'000000':'999999',async()=>key,now,
 ),false);
 assert.deepEqual(f.events,[
  'BEGIN','serialize','lockout','factor','failure','COMMIT','release',
 ]);
});
test('locked enrollment is rejected before reading factor',async()=>{
 const f=fixture(true);
 assert.equal(await activateAdminTotpInTransaction(
  f.pool,staffId,code,async()=>key,now,
 ),false);
 assert.deepEqual(f.events,[
  'BEGIN','serialize','lockout','ROLLBACK','release',
 ]);
});
test('invalid staff identifier never opens a database connection',async()=>{
 let connections=0;
 const pool={connect:async()=>{connections++;throw Error('should not connect');}} as never;
 assert.equal(await activateAdminTotpInTransaction(
  pool,'not-a-uuid',code,async()=>key,now,
 ),false);
 assert.equal(connections,0);
});
