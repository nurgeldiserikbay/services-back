import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {createAdminMfaKeyResolver} from '../src/modules/admin/admin-mfa-key-resolver.js';

test('admin MFA key resolver enforces an explicit version allowlist',async()=>{
 let reads=0;
 const original=randomBytes(32);
 const resolve=createAdminMfaKeyResolver(async(version)=>{
  reads++;
  assert.equal(version,'rotation_2');
  return original;
 },['rotation_2']);
 for(const version of ['unknown','rotation_2/../secret','', 'ROTATION_2']){
  assert.equal(await resolve(version),null);
 }
 assert.equal(reads,0);
 const result=await resolve('rotation_2');
 assert.deepEqual(result,original);
 assert.notEqual(result,original);
 result!.fill(0);
 assert.notDeepEqual(original,result);
 assert.equal(reads,1);
});

test('admin MFA resolver rejects invalid configuration and wrong key length',async()=>{
 for(const versions of [[],['bad/version'],['same','same'],Array(17).fill('v')]){
  assert.throws(()=>createAdminMfaKeyResolver(async()=>randomBytes(32),versions));
 }
 const resolve=createAdminMfaKeyResolver(async()=>randomBytes(31),['v1']);
 assert.equal(await resolve('v1'),null);
});
