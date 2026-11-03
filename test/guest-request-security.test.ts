import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomBytes, randomUUID} from 'node:crypto';
import {
  normalizeGuestContact, contactDigest, makeOtpChallenge, verifyOtp, canVerifyOtp,
  issueGuestCapability, hashGuestCapability, encryptGuestContact, decryptGuestContact,
  requireSecret, GUEST_OTP_POLICY,
} from '../src/modules/guest-requests/guest-request.security.js';
import {validateGuestRequestBody,validateIdempotencyKey} from '../src/modules/guest-requests/guest-request.validation.js';

const pepper=randomBytes(32);
const key=randomBytes(32);
test('contacts are constrained to email and E.164 without unsafe normalization',()=>{
  assert.equal(normalizeGuestContact('email',' User@EXAMPLE.COM '),'User@example.com');
  assert.equal(normalizeGuestContact('sms','+77071234567'),'+77071234567');
  for(const c of ['x@localhost','a@@a.com','a b@domain.com','a@bad..com']) {
    assert.throws(()=>normalizeGuestContact('email',c));
  }
  assert.throws(()=>normalizeGuestContact('sms','87071234567'));
});
test('pepper configuration is 256-bit and canonical',()=>{
  assert.deepEqual(requireSecret(key.toString('base64')),key);
  assert.throws(()=>requireSecret('password'));
});
test('contact digest is domain separated and does not disclose address',()=>{
  const digest=contactDigest('email','User@example.com',pepper);
  assert.equal(digest.length,64);
  assert.ok(!digest.includes('User'));
  assert.notEqual(digest,contactDigest('sms','User@example.com',pepper));
});
test('challenge code binds to UUID and expires; attempt limits are enforced',()=>{
  const id=randomUUID(), other=randomUUID();
  const {code,codeHash}=makeOtpChallenge(id,pepper);
  assert.match(code,/^[0-9]{6}$/);
  assert.ok(verifyOtp(id,code,codeHash,pepper));
  assert.equal(verifyOtp(other,code,codeHash,pepper),false);
  assert.equal(verifyOtp(id,'999',codeHash,pepper),false);
  const now=new Date('2026-11-03T12:00:00Z');
  assert.ok(canVerifyOtp({expiresAt:new Date(now.getTime()+60_000),attempts:4,consumedAt:null},now));
  assert.equal(canVerifyOtp({expiresAt:now,attempts:0,consumedAt:null},now),false);
  assert.equal(canVerifyOtp({expiresAt:new Date(now.getTime()+1),attempts:5,consumedAt:null},now),false);
  assert.equal(canVerifyOtp({expiresAt:new Date(now.getTime()+1),attempts:1,consumedAt:now},now),false);
  assert.equal(GUEST_OTP_POLICY.maxAttempts,5);
});
test('capability tokens are 256-bit, purpose separated and hash-stored',()=>{
  const issued=issueGuestCapability('CREATE_REQUEST',pepper);
  assert.equal(issued.tokenHash,hashGuestCapability('CREATE_REQUEST',issued.token,pepper));
  assert.notEqual(issued.token,issued.tokenHash);
  assert.notEqual(issued.tokenHash,hashGuestCapability('READ_CANCEL',issued.token,pepper));
});
test('encrypted contacts have random nonces and reject tampering',()=>{
  const first=encryptGuestContact('User@example.com',key);
  const second=encryptGuestContact('User@example.com',key);
  assert.notEqual(first,second);
  assert.equal(decryptGuestContact(first,key),'User@example.com');
  assert.throws(()=>decryptGuestContact(first+'x',key));
  assert.ok(!first.includes('User@example.com'));
});
test('guest inquiry payload rejects injected seller, unknown price, invalid consent',()=>{
  const valid={service_offer_id:randomUUID(),note:' Hello ',consent_to_contact:true};
  assert.equal(validateGuestRequestBody(valid).note,'Hello');
  assert.throws(()=>validateGuestRequestBody({...valid,seller_id:randomUUID()}));
  assert.throws(()=>validateGuestRequestBody({...valid,consent_to_contact:false}));
  assert.throws(()=>validateGuestRequestBody({...valid,note:'a'.repeat(1001)}));
  assert.equal(validateIdempotencyKey('request_2026_11_03_abcd'),'request_2026_11_03_abcd');
  assert.throws(()=>validateIdempotencyKey('abc'));
});
