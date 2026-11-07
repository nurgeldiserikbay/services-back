import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {
 issueAdminSessionToken,hashAdminSessionToken,adminSessionHashMatches,
} from '../src/modules/admin/admin-session-token.js';
import {hashSessionToken,issueSessionToken}
 from '../src/modules/identity/session-proof.js';

test('admin tokens have separate hash domain from regular account sessions',()=>{
 const pepper=randomBytes(32);
 const {token,tokenHash}=issueAdminSessionToken(pepper);
 assert.match(token,/^[A-Za-z0-9_-]{43}$/);
 assert.match(tokenHash,/^[a-f0-9]{64}$/);
 assert.notEqual(tokenHash,hashSessionToken(token,pepper));
 assert.equal(adminSessionHashMatches(token,tokenHash,pepper),true);
 assert.equal(adminSessionHashMatches(issueSessionToken(pepper).token,tokenHash,pepper),false);
 assert.equal(adminSessionHashMatches(token,tokenHash,randomBytes(32)),false);
});
test('admin token hashing rejects missing, invalid or weak secrets',()=>{
 const pepper=randomBytes(32);
 const token=issueAdminSessionToken(pepper).token;
 for(const weak of [Buffer.alloc(0),Buffer.alloc(16)]){
  assert.throws(()=>issueAdminSessionToken(weak));
  assert.throws(()=>hashAdminSessionToken(token,weak));
 }
 for(const invalid of [null,undefined,'bad',token+'=',42]){
  assert.throws(()=>hashAdminSessionToken(invalid,pepper));
  assert.equal(adminSessionHashMatches(invalid,'a'.repeat(64),pepper),false);
 }
 assert.equal(adminSessionHashMatches(token,'INVALID',pepper),false);
});
