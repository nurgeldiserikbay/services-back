import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {ServiceUnavailableException} from '@nestjs/common';
import {GuestOtpDispatchService} from '../src/modules/guest-requests/guest-otp-dispatch.service.js';
import type {GuestChallengeIssuanceService} from '../src/modules/guest-requests/guest-challenge-issuance.service.js';
import type {OtpDeliveryService} from '../src/modules/guest-requests/otp-delivery.service.js';
import type {DatabasePool} from '../src/platform/database/database.pool.js';

const fixture={challengeId:randomUUID(),code:'012345',contact:'somebody@example.org',
  channel:'email' as const,expiresInSeconds:600};
test('dispatch returns only safe metadata and passes the code to delivery',async()=>{
  let called=0;
  const issuer={issueCreateRequest:async()=>fixture} as GuestChallengeIssuanceService;
  const delivery={deliverCommittedChallenge:async(input:unknown)=>{
    called++;
    assert.deepEqual(input,{code:fixture.code,contact:fixture.contact,
      channel:'email',locale:'kk',expiresInSeconds:600});
    return {accepted:true,providerRef:'fixture_123456'};
  }} as OtpDeliveryService;
  const database={query:async()=>{throw new Error('should not revoke success');}} as unknown as DatabasePool;
  const service=new GuestOtpDispatchService(issuer,delivery,database);
  assert.deepEqual(await service.dispatchCreateRequest('email',fixture.contact,'kk'),{
    challengeId:fixture.challengeId,expiresInSeconds:600,
  });
  assert.equal(called,1);
});

test('provider failure revokes committed challenge and never refunds send quota',async()=>{
  const issuer={issueCreateRequest:async()=>fixture} as GuestChallengeIssuanceService;
  const delivery={deliverCommittedChallenge:async()=>{throw new Error('sensitive provider failure');}}
    as unknown as OtpDeliveryService;
  const updates:unknown[][]=[];
  const database={query:async(sql:string,args:unknown[])=>{
    assert.match(sql,/UPDATE guest_challenges SET consumed_at=now/);
    updates.push(args);
  }} as unknown as DatabasePool;
  const service=new GuestOtpDispatchService(issuer,delivery,database);
  await assert.rejects(service.dispatchCreateRequest('email',fixture.contact,'ru'),
    (error:unknown)=>error instanceof ServiceUnavailableException &&
      !String(error.message).includes('sensitive'));
  assert.deepEqual(updates,[[fixture.challengeId]]);
});

test('revoke failure stays fail closed and malformed locale does not issue',async()=>{
  let calls=0;
  const issuer={issueCreateRequest:async()=>{calls++;return fixture;}}
    as GuestChallengeIssuanceService;
  const delivery={deliverCommittedChallenge:async()=>({accepted:false,providerRef:null})}
    as OtpDeliveryService;
  const database={query:async()=>{throw new Error('sensitive DB error');}}
    as unknown as DatabasePool;
  const service=new GuestOtpDispatchService(issuer,delivery,database);
  await assert.rejects(service.dispatchCreateRequest('email',fixture.contact,'ru'),
    ServiceUnavailableException);
  await assert.rejects(service.dispatchCreateRequest('email',fixture.contact,'en' as never),
    ServiceUnavailableException);
  assert.equal(calls,1);
});
