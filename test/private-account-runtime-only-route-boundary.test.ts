import 'reflect-metadata';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {NotFoundException} from '@nestjs/common';
import {AccountLoginPrivateController} from '../src/modules/identity/account-login-private.controller.js';
import {AccountOtpDispatchPrivateController} from '../src/modules/identity/account-otp-dispatch-private.controller.js';

test('private account verification and OTP issuance default-deny before service access',async()=>{
 const prior={
  verify:process.env.SERVICES_ENABLE_ACCOUNT_LOGIN_HTTP,
  issue:process.env.SERVICES_ENABLE_ACCOUNT_OTP_DISPATCH_HTTP,
  key:process.env.ACCOUNT_LOGIN_BFF_KEY,
 };
 let signInCalls=0,dispatchCalls=0;
 const verify=new AccountLoginPrivateController({
  signIn:async()=>{signInCalls++;throw Error('unexpected_sign_in');},
 } as never);
 const issue=new AccountOtpDispatchPrivateController({
  dispatch:async()=>{dispatchCalls++;throw Error('unexpected_dispatch');},
 } as never);
 const validBody={channel:'EMAIL',purpose:'SIGN_IN',locale:'kk',
  contact:'example@example.invalid'};
 const verifyBody={challenge_id:'12345678-1234-4234-8234-123456789012',
  channel:'EMAIL',code:'123456'};
 try{
  // Even with an apparently configured private key, production defaults
  // must refuse both endpoints before touching auth, OTP or database services.
  process.env.ACCOUNT_LOGIN_BFF_KEY=Buffer.alloc(32,0x31).toString('base64');
  for(const setting of [undefined,'disabled','true','ENABLED']){
   if(setting===undefined){
    delete process.env.SERVICES_ENABLE_ACCOUNT_LOGIN_HTTP;
    delete process.env.SERVICES_ENABLE_ACCOUNT_OTP_DISPATCH_HTTP;
   }else{
    process.env.SERVICES_ENABLE_ACCOUNT_LOGIN_HTTP=setting;
    process.env.SERVICES_ENABLE_ACCOUNT_OTP_DISPATCH_HTTP=setting;
   }
   await assert.rejects(verify.verify('invalid-key',verifyBody),NotFoundException);
   await assert.rejects(issue.issue('invalid-key','untrusted-proof',validBody),
    NotFoundException);
  }
  assert.equal(signInCalls,0);
  assert.equal(dispatchCalls,0);

  // The two release switches are independent; a login verify rollout cannot
  // implicitly expose provider-facing OTP issuance or vice versa.
  process.env.SERVICES_ENABLE_ACCOUNT_LOGIN_HTTP='enabled';
  delete process.env.SERVICES_ENABLE_ACCOUNT_OTP_DISPATCH_HTTP;
  await assert.rejects(issue.issue('invalid-key','untrusted-proof',validBody),
   NotFoundException);
  process.env.SERVICES_ENABLE_ACCOUNT_OTP_DISPATCH_HTTP='enabled';
  delete process.env.SERVICES_ENABLE_ACCOUNT_LOGIN_HTTP;
  await assert.rejects(verify.verify('invalid-key',verifyBody),NotFoundException);

  // With both switches enabled, an untrusted caller still cannot proceed
  // past the independent BFF key boundary.
  process.env.SERVICES_ENABLE_ACCOUNT_LOGIN_HTTP='enabled';
  process.env.SERVICES_ENABLE_ACCOUNT_OTP_DISPATCH_HTTP='enabled';
  for(const key of [undefined,'','not-base64',
   Buffer.alloc(32,0x32).toString('base64')]){
   await assert.rejects(verify.verify(key,verifyBody),NotFoundException);
   await assert.rejects(issue.issue(key,'untrusted-proof',validBody),
    NotFoundException);
  }
  assert.equal(signInCalls,0);
  assert.equal(dispatchCalls,0);
 }finally{
  if(prior.verify===undefined)delete process.env.SERVICES_ENABLE_ACCOUNT_LOGIN_HTTP;
  else process.env.SERVICES_ENABLE_ACCOUNT_LOGIN_HTTP=prior.verify;
  if(prior.issue===undefined)delete process.env.SERVICES_ENABLE_ACCOUNT_OTP_DISPATCH_HTTP;
  else process.env.SERVICES_ENABLE_ACCOUNT_OTP_DISPATCH_HTTP=prior.issue;
  if(prior.key===undefined)delete process.env.ACCOUNT_LOGIN_BFF_KEY;
  else process.env.ACCOUNT_LOGIN_BFF_KEY=prior.key;
 }
});
