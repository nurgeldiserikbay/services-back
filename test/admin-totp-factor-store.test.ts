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
