import assert from 'node:assert/strict';
import {test} from 'node:test';
import {BadRequestException} from '@nestjs/common';
import {validateIdempotencyKey,validateGuestRequestBody} from '../src/modules/guest-requests/guest-request.validation.js';

const offerId='11111111-1111-4111-8111-111111111111';

test('wizard-generated guest idempotency key is accepted by backend',()=>{
  const key='guest_'+'0123456789abcdef'.repeat(2);
  assert.equal(validateIdempotencyKey(key),key);
});

test('guest idempotency key rejects malformed and too-short values',()=>{
  for(const key of ['', 'guest_', 'a'.repeat(129), 'has spaces', null]){
    assert.throws(()=>validateIdempotencyKey(key),BadRequestException);
  }
});

test('guest request body rejects browser-provided capability and price',()=>{
  for(const injected of [{request_capability:'secret'},{price:100},{seller_id:offerId}]){
    assert.throws(()=>validateGuestRequestBody({
      service_offer_id:offerId,note:'hello',consent_to_contact:true,...injected,
    }),BadRequestException);
  }
});

test('guest request body only accepts allowlisted fields',()=>{
  assert.deepEqual(validateGuestRequestBody({
    service_offer_id:offerId,note:'  hello  ',consent_to_contact:true,
  }),{serviceOfferId:offerId,note:'hello',consentToContact:true});
});

test('guest request rejects absent consent and invalid offer identity',()=>{
  for(const body of [
    {service_offer_id:offerId,note:'hello',consent_to_contact:false},
    {service_offer_id:'invalid',note:'hello',consent_to_contact:true},
    {service_offer_id:offerId,note:'hello'},
  ]){
    assert.throws(()=>validateGuestRequestBody(body),BadRequestException);
  }
});

test('guest request rejects oversized and control-character notes',()=>{
  for(const note of ['a'.repeat(1001),'hello\u0000world']){
    assert.throws(()=>validateGuestRequestBody({
      service_offer_id:offerId,note,consent_to_contact:true,
    }),BadRequestException);
  }
});
