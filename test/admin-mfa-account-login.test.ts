import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {issueSessionToken} from '../src/modules/identity/session-proof.js';
import {loginAdminWithRecentAccountSession} from '../src/modules/admin/admin-mfa-account-login.js';

test('trusted admin login rejects malformed proof, code, or shared secrets before connecting',async()=>{
 let connections=0;
 const pool={connect:async()=>{connections++;throw Error('unexpected database access');}};
 const accountSessionPepper=randomBytes(32);
 const adminSessionPepper=randomBytes(32);
 const token=issueSessionToken(accountSessionPepper).token;
 const resolveTotpKey=async()=>randomBytes(32);
 const deps={pool,accountSessionPepper,adminSessionPepper,resolveTotpKey};
 for(const [bearer,code] of [
  ['invalid','123456'],['Bearer '+token,'123456'],
  [token,'12345'],[token,'1234567'],[token,'123x56'],
  [token,null],[null,'123456'],
 ]){
  assert.equal(await loginAdminWithRecentAccountSession(
   deps as never,bearer,code),null);
 }
 assert.equal(await loginAdminWithRecentAccountSession(
  {...deps,adminSessionPepper:accountSessionPepper} as never,token,'123456'),null);
 assert.equal(await loginAdminWithRecentAccountSession(
  {...deps,resolveTotpKey:null} as never,token,'123456'),null);
 assert.equal(connections,0);
});
