import assert from 'node:assert/strict';
import {test} from 'node:test';
import {parseOtpGatewayStagingPreflightInputs} from
 '../src/platform/ingress/otp-gateway-staging-preflight.reference.js';

const valid={
 OTP_GATEWAY_MONITOR_ENV:'staging',
 OTP_GATEWAY_MONITOR_EXPECTED_HOST:'gateway.internal',
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
  ['OTP_GATEWAY_MONITOR_EXPECTED_HOST',''],
 ] as const){
  assert.throws(
   ()=>parseOtpGatewayStagingPreflightInputs(
    ['--staging-read-only'],{...valid,[key]:bad},
   ),
   {message:'otp_gateway_staging_preflight_unavailable'},
  );
 }
});

test('OTP staging preflight pins operator-approved hostname before connecting',()=>{
 for(const host of [
  'services.internal','gateway.internal.evil.example','localhost',
  '127.0.0.1','*.internal','gateway.internal:5432',
  'https://gateway.internal','GATEWAY.INTERNAL',
  '-gateway.internal','gateway-.internal','gateway..internal',
 ]){
  assert.throws(
   ()=>parseOtpGatewayStagingPreflightInputs(
    ['--staging-read-only'],
    {...valid,OTP_GATEWAY_MONITOR_EXPECTED_HOST:host},
   ),
   {message:'otp_gateway_staging_preflight_unavailable'},
   host,
  );
 }
 for(const url of [
  'postgresql://observer:secret@services.internal:5432/otp',
  'postgresql://observer:secret@gateway.internal.evil.example:5432/otp',
  'http://observer:secret@gateway.internal:5432/otp',
  'not a url',
 ]){
  assert.throws(
   ()=>parseOtpGatewayStagingPreflightInputs(
    ['--staging-read-only'],
    {...valid,OTP_GATEWAY_MONITOR_DATABASE_URL:url},
   ),
   {message:'otp_gateway_staging_preflight_unavailable'},
   url.replace(/secret/g,'[redacted]'),
  );
 }
});
