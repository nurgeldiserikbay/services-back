import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {createPrivateAdminMfaDependencies} from '../src/modules/admin/admin-mfa-private-dependencies.js';

test('private admin MFA dependencies require isolated 32-byte secrets and allowlisted vault versions',async()=>{
 const account=randomBytes(32).toString('base64');
 const admin=randomBytes(32).toString('base64');
 const transport=randomBytes(32).toString('base64');
 let reads=0;
 const input={
  pool:{connect:async()=>{throw Error('not used');}} as never,
  accountSessionHmacKey:account,
  adminSessionHmacKey:admin,
  transportKey:transport,
  allowedTotpVersions:['v1'],
  readTotpKey:async(version:string)=>{reads++;assert.equal(version,'v1');return randomBytes(32);},
 };
 const deps=createPrivateAdminMfaDependencies(input);
 assert.equal(Object.isFrozen(deps),true);
 assert.notDeepEqual(deps.accountSessionPepper,deps.adminSessionPepper);
 assert.equal(await deps.resolveTotpKey('other'),null);
 assert.equal(reads,0);
 assert.equal((await deps.resolveTotpKey('v1'))?.length,32);
 assert.equal(reads,1);
 for(const changed of [
  {adminSessionHmacKey:account},
  {transportKey:account},
  {transportKey:admin},
  {accountSessionHmacKey:'invalid'},
  {allowedTotpVersions:['../escape']},
 ]){
  assert.throws(()=>createPrivateAdminMfaDependencies({...input,...changed}));
 }
});

test('vault TOTP key must be isolated from every session and transport key',async()=>{
 const account=randomBytes(32);
 const admin=randomBytes(32);
 const transport=randomBytes(32);
 const vaultKey=randomBytes(32);
 let current=vaultKey;
 let reads=0;
 const deps=createPrivateAdminMfaDependencies({
  pool:{connect:async()=>{throw Error('not used');}} as never,
  accountSessionHmacKey:account.toString('base64'),
  adminSessionHmacKey:admin.toString('base64'),
  transportKey:transport.toString('base64'),
  allowedTotpVersions:['v1'],
  readTotpKey:async()=>{reads++;return current;},
 });
 for(const reused of [account,admin,transport]){
  current=reused;
  assert.equal(await deps.resolveTotpKey('v1'),null);
  // Rejection must not mutate the source buffer held by the vault adapter.
  assert.deepEqual(current,reused);
 }
 assert.equal(reads,3);
 current=vaultKey;
 const resolved=await deps.resolveTotpKey('v1');
 assert.deepEqual(resolved,vaultKey);
 assert.notEqual(resolved,vaultKey);
 assert.equal(await deps.resolveTotpKey('unknown'),null);
 assert.equal(reads,4);
});
