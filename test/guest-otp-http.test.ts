import 'reflect-metadata';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomBytes,randomUUID} from 'node:crypto';
import {NotFoundException,UnauthorizedException,ServiceUnavailableException}
  from '@nestjs/common';
import {GuestOtpHttpController} from '../src/modules/guest-requests/guest-otp-http.controller.js';
import type {GuestOtpDispatchService} from '../src/modules/guest-requests/guest-otp-dispatch.service.js';
import type {GuestChallengeVerificationService} from '../src/modules/guest-requests/guest-challenge-verification.service.js';

const challengeId=randomUUID();
const capability=randomBytes(32).toString('base64url');
async function flag<T>(setting:string|undefined,fn:()=>Promise<T>):Promise<T>{
  const saved=process.env.SERVICES_ENABLE_GUEST_OTP_HTTP;
  try{
    if(setting===undefined)delete process.env.SERVICES_ENABLE_GUEST_OTP_HTTP;
    else process.env.SERVICES_ENABLE_GUEST_OTP_HTTP=setting;
    return await fn();
  }finally{
    if(saved===undefined)delete process.env.SERVICES_ENABLE_GUEST_OTP_HTTP;
    else process.env.SERVICES_ENABLE_GUEST_OTP_HTTP=saved;
  }
}

test('OTP HTTP is disabled by default and never calls underlying services',async()=>{
  let sends=0,verifications=0;
  const sending={dispatchCreateRequest:async()=>{sends++;return {challengeId,expiresInSeconds:600};}}
  as unknown as GuestOtpDispatchService;
  const verifying={verifyCreateRequest:async()=>{verifications++;return {guestCapability:capability,expiresInSeconds:900};}}
  as unknown as GuestChallengeVerificationService;
  const http=new GuestOtpHttpController(sending,verifying);
  for(const value of [undefined,'true','1','ENABLED','disabled']){
    await flag(value,async()=>{
      await assert.rejects(http.requestCode({channel:'sms',contact:'+77001234567',locale:'kk'}),NotFoundException);
      await assert.rejects(http.verifyCode(challengeId,{code:'123456'}),NotFoundException);
    });
  }
  assert.equal(sends,0);
  assert.equal(verifications,0);
});

test('enabled OTP issue returns only the challenge ID, never contact or OTP',async()=>{
  let calls=0;
  const sending={dispatchCreateRequest:async(channel:unknown,contact:unknown,locale:unknown)=>{
    calls++;
    assert.equal(channel,'email');
    assert.equal(contact,'guest@example.kz');
    assert.equal(locale,'ru');
    return {challengeId,expiresInSeconds:600,code:'123456',contact:'guest@example.kz'};
  }} as unknown as GuestOtpDispatchService;
  const http=new GuestOtpHttpController(sending,{} as GuestChallengeVerificationService);
  const result=await flag('enabled',()=>http.requestCode({
    channel:'email',contact:'guest@example.kz',locale:'ru',
  }));
  assert.deepEqual(result,{challenge_id:challengeId});
  assert.equal(calls,1);
  for(const body of [
    null,{},[],{channel:'sms',contact:'x',locale:'en'},
    {channel:'sms',contact:'x',locale:'kk',admin:true},
    {channel:'push',contact:'x',locale:'kk'},
    {channel:'sms',contact:12,locale:'kk'},
  ]){
    await flag('enabled',()=>assert.rejects(http.requestCode(body),ServiceUnavailableException));
  }
  assert.equal(calls,1);
});

test('enabled OTP verify maps proof only for BFF and rejects malformed input',async()=>{
  let calls=0;
  const verifying={verifyCreateRequest:async(id:unknown,code:unknown)=>{
    calls++;assert.equal(id,challengeId);assert.equal(code,'012345');
    return {guestCapability:capability,expiresInSeconds:900};
  }} as unknown as GuestChallengeVerificationService;
  const http=new GuestOtpHttpController({} as GuestOtpDispatchService,verifying);
  const before=Date.now();
  const result=await flag('enabled',()=>http.verifyCode(challengeId,{code:'012345'}));
  assert.deepEqual(Object.keys(result),['guest_capability','expires_at']);
  assert.equal(result.guest_capability,capability);
  assert.ok(Date.parse(result.expires_at)>=before+899000);
  assert.ok(Date.parse(result.expires_at)<=Date.now()+900000);
  for(const [id,body] of [
    [randomUUID(),{code:123456}],['bad',{code:'012345'}],
    [challengeId,{code:'12345'}],[challengeId,{code:'000000',other:true}],
    [challengeId,null],
  ] as [unknown,unknown][])
    await flag('enabled',()=>assert.rejects(http.verifyCode(id,body),UnauthorizedException));
  assert.equal(calls,1);
});

test('OTP service errors are not converted into successful verification',async()=>{
  const http=new GuestOtpHttpController({
    dispatchCreateRequest:async()=>{throw new ServiceUnavailableException('OTP temporarily unavailable');},
  } as unknown as GuestOtpDispatchService,{
    verifyCreateRequest:async()=>{throw new UnauthorizedException('Invalid or expired verification code');},
  } as unknown as GuestChallengeVerificationService);
  await flag('enabled',async()=>{
    await assert.rejects(http.requestCode({channel:'sms',contact:'+77001234567',locale:'kk'}),ServiceUnavailableException);
    await assert.rejects(http.verifyCode(challengeId,{code:'012345'}),UnauthorizedException);
  });
});

test('OTP route metadata uses no-store and noindex on both sensitive methods',()=>{
  assert.equal(Reflect.getMetadata('path',GuestOtpHttpController),'guest-requests/challenges');
  for(const method of [GuestOtpHttpController.prototype.requestCode,
    GuestOtpHttpController.prototype.verifyCode]){
    const headers=Reflect.getMetadata('__headers__',method) as Array<{name:string;value:string}>;
    const map=new Map(headers.map(h=>[h.name.toLowerCase(),h.value]));
    assert.match(map.get('cache-control')??'',/no-store/);
    assert.equal(map.get('pragma'),'no-cache');
    assert.match(map.get('x-robots-tag')??'',/noindex/);
  }
  assert.equal(Reflect.getMetadata('__httpCode__',GuestOtpHttpController.prototype.requestCode),202);
  assert.equal(Reflect.getMetadata('__httpCode__',GuestOtpHttpController.prototype.verifyCode),200);
});
