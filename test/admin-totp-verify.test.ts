import {test} from 'node:test';
import assert from 'node:assert/strict';
import {verifyAdminTotp} from '../src/modules/admin/admin-totp-verify.js';

// RFC 6238 Appendix B SHA-1 vector: 59 seconds => 94287082 (8 digits).
// The six-digit variant retains the final six digits.
const secret=Buffer.from('12345678901234567890','ascii');

test('TOTP verification matches RFC 6238 SHA-1 vector',()=>{
 assert.equal(verifyAdminTotp(secret,'287082',59_000),1);
 assert.equal(verifyAdminTotp(secret,'287082',90_000),null);
});

test('TOTP verification accepts only adjacent time steps',()=>{
 assert.equal(verifyAdminTotp(secret,'287082',30_000),1);
 assert.equal(verifyAdminTotp(secret,'287082',119_000),null);
});

test('TOTP verification rejects malformed codes, keys and clocks',()=>{
 for(const code of ['28708','0287082','287082 ','287O82',287082,null,undefined]){
  assert.equal(verifyAdminTotp(secret,code,59_000),null);
 }
 for(const key of [Buffer.alloc(0),Buffer.alloc(19),Buffer.alloc(129),'not-secret',null]){
  assert.equal(verifyAdminTotp(key as never,'287082',59_000),null);
 }
 for(const time of [-1,NaN,Infinity,1.5,Number.MAX_SAFE_INTEGER]){
  assert.equal(verifyAdminTotp(secret,'287082',time),null);
 }
});

test('TOTP verification does not accept previous step before epoch',()=>{
 assert.equal(verifyAdminTotp(secret,'287082',0),1);
});
