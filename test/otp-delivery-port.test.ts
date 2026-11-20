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

test('provider deadline aborts hung delivery, fails closed and never accepts late success',async()=>{
  let signal:AbortSignal|undefined;
  let succeedLate:((receipt:{accepted:boolean;providerRef:string|null})=>void)|undefined;
  const provider:OtpDeliveryPort={deliverOtp:async(_message,providedSignal)=>{
    signal=providedSignal;
    return new Promise(resolve=>{succeedLate=resolve;});
  }};
  const service=new OtpDeliveryService(provider,15);
  const result=service.deliverCommittedChallenge({
    code:valid.code,contact:valid.destination,channel:valid.channel,
    locale:valid.locale,expiresInSeconds:valid.expiresInSeconds,
  });
  await assert.rejects(result,error=>error instanceof Error&&
    !error.message.includes(valid.code)&&!error.message.includes(valid.destination));
  assert.equal(signal?.aborted,true,'slow provider must receive cancellation');
  assert.ok(succeedLate);
  succeedLate!({accepted:true,providerRef:'late_accepted_123'});
  await new Promise(resolve=>setImmediate(resolve));
});

test('provider errors reject with one sanitized message and abort signal',async()=>{
  let aborted=false;
  const provider:OtpDeliveryPort={deliverOtp:async(_,signal)=>{
    signal?.addEventListener('abort',()=>{aborted=true;},{once:true});
    throw new Error('secret '+valid.destination+' '+valid.code);
  }};
  await assert.rejects(new OtpDeliveryService(provider,100).deliverCommittedChallenge({
    code:valid.code,contact:valid.destination,channel:valid.channel,
    locale:valid.locale,expiresInSeconds:600,
  }),error=>error instanceof Error&&
    error.message==='OTP delivery temporarily unavailable');
  assert.equal(aborted,true);
});

test('invalid provider deadline never calls the external provider',async()=>{
  let called=false;
  const provider:OtpDeliveryPort={deliverOtp:async()=>{
    called=true;
    return {accepted:true,providerRef:'should_not_send'};
  }};
  await assert.rejects(new OtpDeliveryService(provider,0).deliverCommittedChallenge({
    code:valid.code,contact:valid.destination,channel:valid.channel,
    locale:valid.locale,expiresInSeconds:600,
  }));
  assert.equal(called,false);
});
