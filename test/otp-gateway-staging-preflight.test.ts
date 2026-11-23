import assert from 'node:assert/strict';
import {test} from 'node:test';
import {parseOtpGatewayStagingPreflightInputs} from
 '../src/platform/ingress/otp-gateway-staging-preflight.reference.js';

const valid={
 OTP_GATEWAY_MONITOR_ENV:'staging',
 OTP_GATEWAY_MONITOR_DATABASE_URL:'postgresql://observer:secret@gateway.internal:5432/otp',
 OTP_GATEWAY_MONITOR_SCHEMA:'otp_gateway',
 OTP_GATEWAY_MONITOR_CA_PEM:'fake-for-argument-gate-only',
};

test('OTP staging preflight requires explicit staging-only read-only opt-in',()=>{
 assert.deepEqual(
  parseOtpGatewayStagingPreflightInputs(['--staging-read-only'],valid),
  {databaseUrl:valid.OTP_GATEWAY_MONITOR_DATABASE_URL,
   schema:valid.OTP_GATEWAY_MONITOR_SCHEMA,
   caPem:valid.OTP_GATEWAY_MONITOR_CA_PEM},
 );
 for(const args of [[],['--read-only'],['--staging-read-only','extra']]){
  assert.throws(()=>parseOtpGatewayStagingPreflightInputs(args,valid),{
   message:'otp_gateway_staging_preflight_unavailable',
  });
 }
 for(const [key,bad] of [
  ['OTP_GATEWAY_MONITOR_ENV','production'],
  ['OTP_GATEWAY_MONITOR_ENV',''],
  ['OTP_GATEWAY_MONITOR_DATABASE_URL',''],
  ['OTP_GATEWAY_MONITOR_SCHEMA',''],
  ['OTP_GATEWAY_MONITOR_CA_PEM',''],
 ] as const){
  assert.throws(
   ()=>parseOtpGatewayStagingPreflightInputs(
    ['--staging-read-only'],{...valid,[key]:bad},
   ),
   {message:'otp_gateway_staging_preflight_unavailable'},
  );
 }
});
