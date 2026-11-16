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

test('private MFA parser rejects getters and hidden properties without invoking accessors',()=>{
 const token=randomBytes(32).toString('base64url');
 let getterCalls=0;
 const accessor=Object.defineProperty({
  account_session_token:token,
 },'totp_code',{
  enumerable:true,
  get(){getterCalls++;throw new Error('getter should not execute');},
 });
 assert.equal(parsePrivateAdminMfaRequest(accessor),null);
 assert.equal(getterCalls,0);
 const hidden=Object.defineProperty({
  account_session_token:token,
  totp_code:'123456',
 },'extra',{value:'unexpected',enumerable:false});
 assert.equal(parsePrivateAdminMfaRequest(hidden),null);
 const symbolic={
  account_session_token:token,
  totp_code:'123456',
  [Symbol('extra')]:true,
 };
 assert.equal(parsePrivateAdminMfaRequest(symbolic),null);
});
