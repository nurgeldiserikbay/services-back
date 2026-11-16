import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {parsePrivateAdminMfaRequest} from '../src/modules/admin/admin-mfa-private-request.js';

test('private MFA exchange accepts only canonical account token and code',()=>{
 const token=randomBytes(32).toString('base64url');
 assert.deepEqual(parsePrivateAdminMfaRequest({
  account_session_token:token,totp_code:'123456',
 }),{account_session_token:token,totp_code:'123456'});
 // Invalid codes must reach the MFA transaction and durable lockout.
 assert.deepEqual(parsePrivateAdminMfaRequest({
  account_session_token:token,totp_code:'12x',
 }),{account_session_token:token,totp_code:'12x'});
 for(const invalid of [
  null,[],Object.assign(Object.create(null),{
   account_session_token:token,totp_code:'123456',
  }),
  {account_session_token:token,totp_code:'123456',staffId:'attacker'},
  {account_session_token:token,totp_code:'123456',authenticatedAt:123},
  {account_session_token:token,totp_code:'123456',key:'secret'},
  {account_session_token:token+'=',totp_code:'123456'},
  {account_session_token:token,totp_code:123456},
  {account_session_token:token,totp_code:'0'.repeat(17)},
  {account_session_token:token},
 ]){
  assert.equal(parsePrivateAdminMfaRequest(invalid),null);
 }
});
