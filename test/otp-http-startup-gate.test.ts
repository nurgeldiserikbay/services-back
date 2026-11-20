import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {OtpDeliveryService} from '../src/modules/guest-requests/otp-delivery.service.js';
import {assertGuestOtpHttpStartupReady} from
 '../src/modules/guest-requests/otp-http-startup-gate.js';

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
  const env={[flag]:'enabled'};
  assert.throws(()=>assertGuestOtpHttpStartupReady(env,none),
   /^Error: Guest OTP HTTP requires configured delivery adapter$/);
  assert.doesNotThrow(()=>assertGuestOtpHttpStartupReady(env,configured));
 }
});

test('startup provider check rejects unresolvable or misleading delivery providers',()=>{
 assert.throws(()=>assertGuestOtpHttpStartupReady({
  SERVICES_ENABLE_GUEST_COMPLETION_HTTP:'enabled',
 },()=>{throw new Error('secret injection details');}),
 /Guest OTP HTTP requires configured delivery adapter/);
 assert.throws(()=>assertGuestOtpHttpStartupReady({
  SERVICES_ENABLE_GUEST_OTP_HTTP:'enabled',
 },()=>({isProviderAttached:()=>false})),
 /Guest OTP HTTP requires configured delivery adapter/);
 assert.throws(()=>assertGuestOtpHttpStartupReady({
  SERVICES_ENABLE_GUEST_SCHEDULE_HTTP:'enabled',
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
