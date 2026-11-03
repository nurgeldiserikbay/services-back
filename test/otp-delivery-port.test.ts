import assert from 'node:assert/strict';
import {test} from 'node:test';
import {OtpDeliveryService} from '../src/modules/guest-requests/otp-delivery.service.js';
import {
  DisabledOtpDelivery,OtpDeliveryUnavailable,
  sanitizeOtpDeliveryReceipt,validateOtpDeliveryMessage,
  type OtpDeliveryMessage,type OtpDeliveryPort,
} from '../src/modules/guest-requests/otp-delivery.port.js';

const valid:OtpDeliveryMessage={
 channel:'sms',destination:'+77001234567',code:'015922',
 purpose:'CREATE_REQUEST',expiresInSeconds:600,locale:'kk',
};
test('delivery defaults to fail-closed rather than returning fabricated success',async()=>{
  await assert.rejects(new DisabledOtpDelivery().deliverOtp(valid),OtpDeliveryUnavailable);
  await assert.rejects(new OtpDeliveryService().deliverCommittedChallenge({
    code:valid.code,contact:valid.destination,channel:valid.channel,
    locale:valid.locale,expiresInSeconds:600,
  }));
});
test('delivery verifies one-time code and endpoint destination format',()=>{
  assert.equal(validateOtpDeliveryMessage(valid),valid);
  for(const bad of [{...valid,code:'123'},{...valid,destination:'87001234567'},
    {...valid,expiresInSeconds:99999},{...valid,locale:'en' as never}]){
    assert.throws(()=>validateOtpDeliveryMessage(bad));
  }
});
test('provider responses are sanitized without leaking unknown provider properties',()=>{
  assert.deepEqual(sanitizeOtpDeliveryReceipt({
    accepted:true,providerRef:'accepted_123456',recipient:'+77001234567',
    rawMessage:'code 123456',headers:{authorization:'secret'},
  }),{accepted:true,providerRef:'accepted_123456'});
  assert.throws(()=>sanitizeOtpDeliveryReceipt({accepted:true,providerRef:'+77001234567'}));
});
test('injected provider can be tested without a real SMS/email message',async()=>{
  const provider:OtpDeliveryPort={deliverOtp:async m=>{
    assert.deepEqual(m,valid);
    return {accepted:true,providerRef:'fixture_12345'};
  }};
  const service=new OtpDeliveryService(provider);
  assert.deepEqual(await service.deliverCommittedChallenge({
    code:valid.code,contact:valid.destination,channel:valid.channel,
    locale:valid.locale,expiresInSeconds:valid.expiresInSeconds,
  }),{accepted:true,providerRef:'fixture_12345'});
});
