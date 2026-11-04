import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {UnauthorizedException,ServiceUnavailableException} from '@nestjs/common';
import {GuestChallengeVerificationService} from '../src/modules/guest-requests/guest-challenge-verification.service.js';
import type {GuestChallengeProofRepository} from '../src/modules/guest-requests/guest-challenge-proof.repository.js';

const id=randomUUID();
const key=randomBytes(32).toString('base64');

test('verified CREATE_REQUEST proof delegates with configured secret',async()=>{
  const old=process.env.GUEST_REQUEST_HMAC_KEY;
  process.env.GUEST_REQUEST_HMAC_KEY=key;
  let calls=0;
  try{
    const repository={async verifyCreateRequest(challenge:string,code:string,pepper:Buffer){
      calls++;
      assert.equal(challenge,id);
      assert.equal(code,'012345');
      assert.equal(pepper.toString('base64'),key);
      return {guestCapability:'x'.repeat(43),expiresInSeconds:900};
    }} as GuestChallengeProofRepository;
    const service=new GuestChallengeVerificationService(repository);
    assert.deepEqual(await service.verifyCreateRequest(id,'012345'),
      {guestCapability:'x'.repeat(43),expiresInSeconds:900});
    assert.equal(calls,1);
  }finally{
    if(old===undefined)delete process.env.GUEST_REQUEST_HMAC_KEY;
    else process.env.GUEST_REQUEST_HMAC_KEY=old;
  }
});

test('malformed proof rejects before database access',async()=>{
  const repository={async verifyCreateRequest(){throw new Error('should_not_query');}}
    as unknown as GuestChallengeProofRepository;
  const service=new GuestChallengeVerificationService(repository);
  for(const [challenge,code] of [[id,'12345'],['invalid','123456'],[id,123456],[null,'123456']]){
    await assert.rejects(service.verifyCreateRequest(challenge,code),UnauthorizedException);
  }
});

test('missing secret and failed proof are rejected',async()=>{
  const old=process.env.GUEST_REQUEST_HMAC_KEY;
  const repository={async verifyCreateRequest(){return null;}}
    as unknown as GuestChallengeProofRepository;
  const service=new GuestChallengeVerificationService(repository);
  try{
    delete process.env.GUEST_REQUEST_HMAC_KEY;
    await assert.rejects(service.verifyCreateRequest(id,'123456'),ServiceUnavailableException);
    process.env.GUEST_REQUEST_HMAC_KEY=key;
    await assert.rejects(service.verifyCreateRequest(id,'123456'),UnauthorizedException);
  }finally{
    if(old===undefined)delete process.env.GUEST_REQUEST_HMAC_KEY;
    else process.env.GUEST_REQUEST_HMAC_KEY=old;
  }
});
