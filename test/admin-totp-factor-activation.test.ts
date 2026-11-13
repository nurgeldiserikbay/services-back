import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHmac,randomBytes,randomUUID} from 'node:crypto';
import {sealAdminTotpSecret} from '../src/modules/admin/admin-totp-secret.js';
import {activateAdminTotpFactor} from '../src/modules/admin/admin-totp-factor-activation.js';

const staffId=randomUUID();
const secret=randomBytes(32);
const key=randomBytes(32);
const now=123456*30000;
const counter=123456;
const input=Buffer.alloc(8);
input.writeBigUInt64BE(BigInt(counter));
const digest=createHmac('sha1',secret).update(input).digest();
const offset=digest[digest.length-1]!&15;
const code=String((digest.readUInt32BE(offset)&0x7fffffff)%1_000_000).padStart(6,'0');
const envelope=sealAdminTotpSecret(secret,staffId,key);

function fakeDb(mode:'valid'|'wrong'|'missing'='valid'){
 const events:string[]=[];
 const db={query:async(sql:string,params:unknown[])=>{
  if(sql.includes('FOR UPDATE OF factor')){
   events.push('read');
   assert.deepEqual(params,[staffId]);
   return {rows:mode==='missing'?[]:[{
    encrypted_secret:mode==='wrong'?'v1.invalid':envelope,key_version:'key-1',
   }]};
  }
  if(sql.includes('platform_admin_totp_replay')){
   events.push('consume-enrollment-code');
   return {rows:[{last_consumed_counter:String(counter)}]};
  }
  if(sql.includes('UPDATE platform_admin_totp_factors')){
   events.push('activate');
   assert.deepEqual(params,[staffId,now]);
   return {rows:[{staff_id:staffId}]};
  }
  throw Error('unexpected query');
 }} as never;
 return {db,events};
}
test('valid TOTP proof activates a pending factor',async()=>{
 const fixture=fakeDb();
 assert.equal(await activateAdminTotpFactor(
  fixture.db,staffId,code,async()=>key,now,
 ),true);
 assert.deepEqual(fixture.events,['read','consume-enrollment-code','activate']);
});
test('wrong code never activates a pending factor',async()=>{
 const fixture=fakeDb();
 assert.equal(await activateAdminTotpFactor(
  fixture.db,staffId,'999999'===code?'000000':'999999',async()=>key,now,
 ),false);
 assert.deepEqual(fixture.events,['read']);
});
test('missing factor and wrong encryption key fail closed',async()=>{
 const missing=fakeDb('missing');
 assert.equal(await activateAdminTotpFactor(
  missing.db,staffId,code,async()=>key,now,
 ),false);
 const wrong=fakeDb();
 assert.equal(await activateAdminTotpFactor(
  wrong.db,staffId,code,async()=>randomBytes(32),now,
 ),false);
 assert.deepEqual(wrong.events,['read']);
});
test('malformed activation input is rejected before database access',async()=>{
 let queries=0;
 const db={query:async()=>{queries++;return {rows:[]};}} as never;
 assert.equal(await activateAdminTotpFactor(
  db,'invalid',code,async()=>key,now,
 ),false);
 assert.equal(await activateAdminTotpFactor(
  db,staffId,'123',async()=>key,now,
 ),false);
 assert.equal(queries,0);
});
