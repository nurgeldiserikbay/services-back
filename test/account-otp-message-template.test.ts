import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {renderAccountOtpMessage} from '../src/modules/identity/account-otp-message-template.js';
import {AccountOtpDeliveryUnavailable} from '../src/modules/identity/account-otp-delivery.port.js';

const base={
 challengeId:randomUUID(),channel:'EMAIL' as const,purpose:'SIGN_IN' as const,
 destination:'account@example.test',code:'012345',expiresInSeconds:300,
 locale:'kk' as const,
};
test('localized email sign-in and signup templates contain only private delivery data',()=>{
 for(const locale of ['kk','ru'] as const){
  for(const purpose of ['SIGN_IN','SIGN_UP'] as const){
   const value=renderAccountOtpMessage({...base,locale,purpose});
   assert.deepEqual(Object.keys(value).sort(),['channel','destination','subject','text']);
   assert.equal(value.destination,base.destination);
   assert.equal(value.channel,'EMAIL');
   assert.equal(typeof value.subject,'string');
   assert.match(value.text,/012345/);
   assert.match(value.text,/5/);
   assert.ok(Object.isFrozen(value));
   assert.equal(JSON.stringify(value).includes(base.challengeId),false);
   assert.equal(value.text.includes(base.destination),false);
  }
 }
});
test('SMS templates do not include email subject and are concise for both locales',()=>{
 for(const locale of ['kk','ru'] as const){
  const item=renderAccountOtpMessage({...base,channel:'SMS',
   destination:'+77001234567',locale});
  assert.equal(item.subject,null);
  assert.match(item.text,/012345/);
  assert.ok(item.text.length<160);
 }
});
test('reject malformed codes, unexpected expiry, locales and header injection',()=>{
 const invalid=[
  {...base,code:'12345'},{...base,code:'12345a'},
  {...base,code:'1234567'},{...base,code:'00000\n'},
  {...base,expiresInSeconds:120},{...base,expiresInSeconds:301},
  {...base,locale:'en'},{...base,purpose:'RESET_PASSWORD'},
  {...base,channel:'PUSH'},{...base,destination:'user\r\nBCC:evil@example.test'},
  {...base,destination:''},null,
 ];
 for(const payload of invalid){
  assert.throws(()=>renderAccountOtpMessage(payload as never),
   AccountOtpDeliveryUnavailable);
 }
});
