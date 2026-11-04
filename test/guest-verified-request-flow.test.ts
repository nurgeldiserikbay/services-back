import assert from 'node:assert/strict';
import {test} from 'node:test';
import {UnauthorizedException} from '@nestjs/common';
import {GuestVerifiedRequestFlow} from '../src/modules/guest-requests/guest-verified-request.flow.js';
import type {GuestChallengeVerificationService} from '../src/modules/guest-requests/guest-challenge-verification.service.js';
import type {GuestRequestService} from '../src/modules/guest-requests/guest-request.service.js';

const proof='a'.repeat(43);
const created={id:'00000000-0000-4000-8000-000000000001',state:'pending' as const,
  requestCapability:'b'.repeat(43),expiresAt:'2026-12-04T00:00:00.000Z'};
const body={service_offer_id:'00000000-0000-4000-8000-000000000002',
  consent_to_contact:true,note:'Fixture'};
const key='guest-flow-idempotency-2026';

test('verified OTP proof is passed only to the atomic request service',async()=>{
  let verificationCalls=0,creationCalls=0;
  const verifier={verifyCreateRequest:async(challenge:unknown,code:unknown)=>{
    verificationCalls++;
    assert.equal(challenge,'challenge-id');assert.equal(code,'012345');
    return {guestCapability:proof,expiresInSeconds:900};
  }} as unknown as GuestChallengeVerificationService;
  const requests={createFromVerifiedContact:async(input:unknown,token:string,idem:unknown)=>{
    creationCalls++;
    assert.equal(input,body);assert.equal(token,proof);assert.equal(idem,key);
    return created;
  }} as unknown as GuestRequestService;
  const flow=new GuestVerifiedRequestFlow(verifier,requests);
  assert.deepEqual(await flow.verifyAndCreate('challenge-id','012345',body,key),created);
  assert.equal(verificationCalls,1);
  assert.equal(creationCalls,1);
});

test('failed OTP verification never creates a service request',async()=>{
  let creationCalls=0;
  const verifier={verifyCreateRequest:async()=>{
    throw new UnauthorizedException('Invalid or expired verification code');
  }} as unknown as GuestChallengeVerificationService;
  const requests={createFromVerifiedContact:async()=>{creationCalls++;return created;}} as unknown as GuestRequestService;
  const flow=new GuestVerifiedRequestFlow(verifier,requests);
  await assert.rejects(flow.verifyAndCreate('bad','123456',body,key),UnauthorizedException);
  assert.equal(creationCalls,0);
});

test('a request creation failure is propagated, never claimed successful',async()=>{
  let verificationCalls=0;
  const verifier={verifyCreateRequest:async()=>{verificationCalls++;
    return {guestCapability:proof,expiresInSeconds:900};
  }} as unknown as GuestChallengeVerificationService;
  const requests={createFromVerifiedContact:async()=>{throw new Error('atomic transaction failed');}} as unknown as GuestRequestService;
  const flow=new GuestVerifiedRequestFlow(verifier,requests);
  await assert.rejects(flow.verifyAndCreate('challenge-id','012345',body,key),
    /atomic transaction failed/);
  assert.equal(verificationCalls,1);
});
