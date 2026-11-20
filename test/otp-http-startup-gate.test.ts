import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {OtpDeliveryService} from '../src/modules/guest-requests/otp-delivery.service.js';
import {assertGuestOtpHttpStartupReady} from
 '../src/modules/guest-requests/otp-http-startup-gate.js';

const trustedNetworkKey=randomBytes(32).toString('base64');
const challengeKey=randomBytes(32).toString('base64');
const contactKey=randomBytes(32).toString('base64');
const validKeys={
 GUEST_NETWORK_ATTESTATION_KEY:trustedNetworkKey,
 GUEST_REQUEST_HMAC_KEY:challengeKey,
 GUEST_CONTACT_ENCRYPTION_KEY:contactKey,
};
const routes=[
 'SERVICES_ENABLE_GUEST_OTP_HTTP',
 'SERVICES_ENABLE_GUEST_SCHEDULE_HTTP',
 'SERVICES_ENABLE_GUEST_COMPLETION_HTTP',
];
const none=()=>new OtpDeliveryService();
const configured=()=>new OtpDeliveryService({
 async deliverOtp(){return {accepted:true,providerRef:'test_only_provider'};}
});

test('disabled guest OTP HTTP never resolves delivery adapter at startup',()=>{
 let calls=0;
 assert.doesNotThrow(()=>assertGuestOtpHttpStartupReady({},()=>{
  calls++;throw new Error('provider should not be checked while disabled');
 }));
 assert.equal(calls,0);
 assert.doesNotThrow(()=>assertGuestOtpHttpStartupReady({
  SERVICES_ENABLE_GUEST_COMPLETION_HTTP:'true',
  SERVICES_ENABLE_GUEST_SCHEDULE_HTTP:'ENABLED',
 },()=>{calls++;return none();}));
 assert.equal(calls,0);
});

test('every independently enabled guest OTP issuance HTTP flag needs real adapter',()=>{
 for(const flag of routes){
  const env={[flag]:'enabled',...validKeys};
  assert.throws(()=>assertGuestOtpHttpStartupReady(env,none),
   /^Error: Guest OTP HTTP requires configured delivery adapter$/);
  assert.doesNotThrow(()=>assertGuestOtpHttpStartupReady(env,configured));
 }
});

test('startup provider check rejects unresolvable or misleading delivery providers',()=>{
 assert.throws(()=>assertGuestOtpHttpStartupReady({
  SERVICES_ENABLE_GUEST_COMPLETION_HTTP:'enabled',
  ...validKeys,
 },()=>{throw new Error('secret injection details');}),
 /Guest OTP HTTP requires configured delivery adapter/);
 assert.throws(()=>assertGuestOtpHttpStartupReady({
  SERVICES_ENABLE_GUEST_OTP_HTTP:'enabled',
  ...validKeys,
 },()=>({isProviderAttached:()=>false})),
 /Guest OTP HTTP requires configured delivery adapter/);
 assert.throws(()=>assertGuestOtpHttpStartupReady({
  SERVICES_ENABLE_GUEST_SCHEDULE_HTTP:'enabled',
  ...validKeys,
 },()=>({isProviderAttached:()=>{throw new Error('sensitive backend failure');}})),
 /Guest OTP HTTP requires configured delivery adapter/);
});

test('main startup applies adapter gate before binding network listener',()=>{
 const source=readFileSync('src/main.ts','utf8');
 const guard=source.indexOf('assertGuestOtpHttpStartupReady(process.env');
 const listen=source.indexOf('await app.listen(port, host)');
 assert.ok(guard>=0&&listen>guard);
 assert.match(source,/app\.get\(OtpDeliveryService,\{strict:false\}\)/);
 const module=readFileSync('src/modules/guest-requests/guest-verification.module.ts','utf8');
 assert.match(module,/new OtpDeliveryService\(\)/);
});

test('OTP HTTP requires valid and distinct domain encryption/HMAC keys',()=>{
 for(const flag of routes){
  for(const missing of ['GUEST_REQUEST_HMAC_KEY','GUEST_CONTACT_ENCRYPTION_KEY']){
   let calls=0;
   const env:{[key:string]:string|undefined}={[flag]:'enabled',...validKeys};
   delete env[missing];
   assert.throws(()=>assertGuestOtpHttpStartupReady(env,()=>{
    calls++;return configured();
   }),/^Error: Guest OTP HTTP requires valid challenge and contact keys$/);
   assert.equal(calls,0,'invalid cryptographic keys must fail before provider resolution');
  }
  for(const [a,b] of [
   ['GUEST_NETWORK_ATTESTATION_KEY','GUEST_REQUEST_HMAC_KEY'],
   ['GUEST_NETWORK_ATTESTATION_KEY','GUEST_CONTACT_ENCRYPTION_KEY'],
   ['GUEST_REQUEST_HMAC_KEY','GUEST_CONTACT_ENCRYPTION_KEY'],
  ]){
   const env:{[key:string]:string|undefined}={[flag]:'enabled',...validKeys};
   env[b]=env[a];
   assert.throws(()=>assertGuestOtpHttpStartupReady(env,configured),
    /^Error: Guest OTP HTTP requires independent cryptographic keys$/);
  }
  assert.doesNotThrow(()=>assertGuestOtpHttpStartupReady({
   [flag]:'enabled',...validKeys,
  },configured));
 }
});

test('OTP HTTP startup refuses absent and malformed trusted network signing keys',()=>{
 for(const flag of routes){
  let resolved=0;
  for(const invalid of [undefined,'','not-a-key',Buffer.alloc(32).toString('hex'),
   trustedNetworkKey.replace(/=$/,'A')]){
   assert.throws(()=>assertGuestOtpHttpStartupReady({
    [flag]:'enabled',...validKeys,GUEST_NETWORK_ATTESTATION_KEY:invalid,
   },()=>{resolved++;return configured();}),
   /^Error: Guest OTP HTTP requires valid trusted ingress key$/);
  }
  assert.equal(resolved,0,'must reject invalid ingress key before resolving provider');
 }
});
