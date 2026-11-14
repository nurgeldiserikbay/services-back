import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {provisionAdminTotpFactor,loadActiveAdminTotpFactor} from '../src/modules/admin/admin-totp-factor-store.js';

const staffId=randomUUID();
const secret=randomBytes(32);
const key=randomBytes(32);

test('factor provisioning stores encrypted secret and key version',async()=>{
 let encrypted='';
 const db={query:async(sql:string,params:unknown[])=>{
  assert.match(sql,/ON CONFLICT \(staff_id\) DO NOTHING/);
  assert.match(sql,/staff\.role IN \('owner','admin','operator','auditor'\)/);
    assert.match(sql,/EXISTS \(SELECT 1 FROM platform_admin_grants grants/);
  assert.equal(params[0],staffId);
  encrypted=params[1] as string;
  assert.notEqual(encrypted,secret.toString('hex'));
  assert.match(encrypted,/^v1\./);
  assert.equal(params[2],'key-1');
  return {rows:[{staff_id:staffId}]};
 }} as never;
 assert.equal(await provisionAdminTotpFactor(db,staffId,secret,'key-1',key),true);
 assert.ok(encrypted);
});

test('only activated factors can be loaded and decrypted',async()=>{
 let envelope='';
 const write={query:async(_sql:string,params:unknown[])=>{
  envelope=params[1] as string;
  return {rows:[{staff_id:staffId}]};
 }} as never;
 await provisionAdminTotpFactor(write,staffId,secret,'key-1',key);
 const read={query:async(sql:string)=>{
  assert.match(sql,/factor.activated_at IS NOT NULL/);
  assert.match(sql,/factor.disabled_at IS NULL/);
  assert.match(sql,/FOR SHARE OF factor/);
  assert.match(sql,/staff\.role IN \('owner','admin','operator','auditor'\)/);
    assert.match(sql,/EXISTS \(SELECT 1 FROM platform_admin_grants grants/);
  return {rows:[{encrypted_secret:envelope,key_version:'key-1'}]};
 }} as never;
 assert.deepEqual(await loadActiveAdminTotpFactor(
  read,staffId,async version=>version==='key-1'?key:null,
 ),secret);
 assert.equal(await loadActiveAdminTotpFactor(
  read,staffId,async()=>null,
 ),null);
});

test('missing factor fails closed without key lookup',async()=>{
 let calls=0;
 const db={query:async()=>({rows:[]})} as never;
 assert.equal(await loadActiveAdminTotpFactor(db,staffId,async()=>{
  calls++;return key;
 }),null);
 assert.equal(calls,0);
});

test('provisioning rejects malformed and mismatched database identities',async()=>{
 for(const rows of [null,[{staff_id:'invalid'}],[{staff_id:randomUUID()}],
  [{staff_id:staffId},{staff_id:staffId}],[{}]]){
  const db={query:async()=>({rows})} as never;
  await assert.rejects(provisionAdminTotpFactor(
   db,staffId,secret,'key-1',key,
  ),/admin_totp_provision_unavailable/);
 }
});

test('duplicate provision attempt does not replace an existing factor',async()=>{
 const db={query:async(sql:string)=>{
  assert.match(sql,/ON CONFLICT \(staff_id\) DO NOTHING/);
  return {rows:[]};
 }} as never;
 assert.equal(await provisionAdminTotpFactor(
  db,staffId,secret,'key-1',key,
 ),false);
});


test('invalid factor key resolver is rejected before querying database',async()=>{
 let calls=0;
 const db={query:async()=>{calls++;throw Error('unexpected database access');}} as never;
 for(const resolver of [null,undefined,'vault-key',{},42]){
  assert.equal(await loadActiveAdminTotpFactor(
   db,staffId,resolver as never,
  ),null);
 }
 assert.equal(calls,0);
});

test('factor loader fails closed on corrupt database rows',async()=>{
 for(const rows of [
  null,
  [{encrypted_secret:'invalid',key_version:'invalid version'}],
  [{encrypted_secret:42,key_version:'key-1'}],
  [{encrypted_secret:'v1.fake',key_version:'key-1'},{encrypted_secret:'v1.fake',key_version:'key-1'}],
 ]){
  const db={query:async()=>({rows})} as never;
  await assert.rejects(loadActiveAdminTotpFactor(
   db,staffId,async()=>key,
  ),/admin_totp_factor_unavailable/);
 }
});

test('factor ciphertext cannot be decrypted for a different staff identity',async()=>{
 const otherStaffId=randomUUID();
 let envelope='';
 const write={query:async(_sql:string,params:unknown[])=>{
  envelope=params[1] as string;
  return {rows:[{staff_id:staffId}]};
 }} as never;
 assert.equal(await provisionAdminTotpFactor(
  write,staffId,secret,'key-1',key,
 ),true);
 const read={query:async(_sql:string,params:unknown[])=>{
  assert.equal(params[0],otherStaffId);
  return {rows:[{encrypted_secret:envelope,key_version:'key-1'}]};
 }} as never;
 assert.equal(await loadActiveAdminTotpFactor(
  read,otherStaffId,async()=>key,
 ),null);
});

test('wrong vault encryption key cannot unlock a provisioned factor',async()=>{
 let envelope='';
 const write={query:async(_sql:string,params:unknown[])=>{
  envelope=params[1] as string;
  return {rows:[{staff_id:staffId}]};
 }} as never;
 await provisionAdminTotpFactor(write,staffId,secret,'key-1',key);
 const read={query:async()=>({
  rows:[{encrypted_secret:envelope,key_version:'key-1'}],
 })} as never;
 assert.equal(await loadActiveAdminTotpFactor(
  read,staffId,async()=>randomBytes(32),
 ),null);
});

test('invalid provisioning key and secret never reach database or encryption',async()=>{
 let queries=0;
 const db={query:async()=>{queries++;throw Error('unexpected SQL');}} as never;
 for(const invalidSecret of [Buffer.alloc(0),Buffer.alloc(19),Buffer.alloc(129)]){
  assert.equal(await provisionAdminTotpFactor(
   db,staffId,invalidSecret,'key-1',key,
  ),false);
 }
 for(const invalidKey of [Buffer.alloc(0),Buffer.alloc(31),Buffer.alloc(33)]){
  assert.equal(await provisionAdminTotpFactor(
   db,staffId,secret,'key-1',invalidKey,
  ),false);
 }
 assert.equal(queries,0);
});

test('TOTP factor store rejects missing database clients before encryption or lookup',async()=>{
 let keyLookups=0;
 for(const db of [null,undefined,{}, {query:null}, {query:'invalid'}]){
  assert.equal(await provisionAdminTotpFactor(
   db as never,staffId,secret,'v1',key,
  ),false);
  assert.equal(await loadActiveAdminTotpFactor(
   db as never,staffId,async()=>{keyLookups++;return key;},
  ),null);
 }
 assert.equal(keyLookups,0);
});
