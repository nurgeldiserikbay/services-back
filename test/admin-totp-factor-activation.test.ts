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
   assert.match(sql,/staff\.role IN \('owner','admin','operator','auditor'\)/);
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

test('factor activation rejects invalid dependencies without SQL or vault access',async()=>{
 let queries=0,keyLookups=0;
 const db={query:async()=>{queries++;throw Error('unexpected SQL');}} as never;
 const resolveKey=async()=>{keyLookups++;return key;};
 for(const invalidDb of [null,undefined,{}, {query:null}, {query:'invalid'}]){
  assert.equal(await activateAdminTotpFactor(
   invalidDb as never,staffId,'123456',resolveKey,now,
  ),false);
 }
 for(const invalidResolver of [null,undefined,{},'invalid']){
  assert.equal(await activateAdminTotpFactor(
   db,staffId,'123456',invalidResolver as never,now,
  ),false);
 }
 assert.equal(queries,0);
 assert.equal(keyLookups,0);
});

test('activation rejects mismatched database confirmation after OTP consumption',async()=>{
 const events:string[]=[];
 const db={query:async(sql:string)=>{
  if(sql.includes('FOR UPDATE OF factor')){
   events.push('read');return {rows:[{encrypted_secret:envelope,key_version:'key-1'}]};
  }
  if(sql.includes('platform_admin_totp_replay')){
   events.push('consume');return {rows:[{last_consumed_counter:String(counter)}]};
  }
  if(sql.includes('UPDATE platform_admin_totp_factors')){
   events.push('activate');return {rows:[{staff_id:randomUUID()}]};
  }
  throw Error('unexpected SQL');
 }} as never;
 await assert.rejects(
  activateAdminTotpFactor(db,staffId,code,async()=>key,now),
  /admin_totp_activation_unavailable/,
 );
 assert.deepEqual(events,['read','consume','activate']);
});

test('activation rejects out-of-range timestamps before SQL',async()=>{
 let queries=0;
 const db={query:async()=>{queries++;throw Error('unexpected SQL');}} as never;
 for(const invalidNow of [-1,NaN,Infinity,8_640_000_000_000_001]){
  assert.equal(await activateAdminTotpFactor(db,staffId,code,async()=>key,invalidNow),false);
 }
 assert.equal(queries,0);
});
