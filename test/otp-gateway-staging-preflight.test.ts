import assert from 'node:assert/strict';
import {test} from 'node:test';
import {parseOtpGatewayStagingPreflightInputs} from
 '../src/platform/ingress/otp-gateway-staging-preflight.reference.js';

const valid={
 OTP_GATEWAY_MONITOR_ENV:'staging',
 OTP_GATEWAY_MONITOR_EXPECTED_HOST:'gateway.internal',
 OTP_GATEWAY_MONITOR_EXPECTED_PORT:'5432',
 OTP_GATEWAY_MONITOR_EXPECTED_DATABASE:'otp',
 OTP_GATEWAY_MONITOR_EXPECTED_ROLE:'observer',
 OTP_GATEWAY_MONITOR_DATABASE_URL:'postgresql://observer:secret@gateway.internal:5432/otp',
 OTP_GATEWAY_MONITOR_SCHEMA:'otp_gateway',
 OTP_GATEWAY_MONITOR_CA_PEM:'fake-for-argument-gate-only',
};

test('OTP staging preflight requires explicit staging-only read-only opt-in',()=>{
 assert.deepEqual(
  parseOtpGatewayStagingPreflightInputs(['--staging-read-only'],valid),
  {databaseUrl:valid.OTP_GATEWAY_MONITOR_DATABASE_URL,
   schema:valid.OTP_GATEWAY_MONITOR_SCHEMA,
   caPem:valid.OTP_GATEWAY_MONITOR_CA_PEM,
   databaseName:valid.OTP_GATEWAY_MONITOR_EXPECTED_DATABASE,
   roleName:valid.OTP_GATEWAY_MONITOR_EXPECTED_ROLE},
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
  ['OTP_GATEWAY_MONITOR_EXPECTED_PORT',''],
  ['OTP_GATEWAY_MONITOR_EXPECTED_DATABASE',''],
  ['OTP_GATEWAY_MONITOR_EXPECTED_ROLE',''],
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

test('OTP staging preflight rejects wrong or unsafe database names before connect',()=>{
 for(const name of ['services','postgres','template0','template1',
  'pg_catalog','PG_PUBLIC','otp;DROP TABLE users','otp-other','otp/backup',
  'otp%2Fbackup','', 'a'.repeat(64)]){
  assert.throws(()=>parseOtpGatewayStagingPreflightInputs(
   ['--staging-read-only'],
   {...valid,OTP_GATEWAY_MONITOR_EXPECTED_DATABASE:name},
  ),{message:'otp_gateway_staging_preflight_unavailable'});
 }
 for(const url of [
  'postgresql://observer:secret@gateway.internal:5432/services',
  'postgresql://observer:secret@gateway.internal:5432/',
  'postgresql://observer:secret@gateway.internal:5432/otp%2Fother',
  'postgresql://observer:secret@gateway.internal:5432/otp/other',
 ]){
  assert.throws(()=>parseOtpGatewayStagingPreflightInputs(
   ['--staging-read-only'],
   {...valid,OTP_GATEWAY_MONITOR_DATABASE_URL:url},
  ),{message:'otp_gateway_staging_preflight_unavailable'});
 }
});

test('staging observer requires an independently approved login role',()=>{
 for(const role of [
  'postgres','pg_monitor','other_observer','observer;SET ROLE admin',
  'UPPER','observer-other','', 'a'.repeat(64),
 ]){
  assert.throws(()=>parseOtpGatewayStagingPreflightInputs(
   ['--staging-read-only'],
   {...valid,OTP_GATEWAY_MONITOR_EXPECTED_ROLE:role},
  ),{message:'otp_gateway_staging_preflight_unavailable'});
 }
 for(const url of [
  'postgresql://admin:secret@gateway.internal:5432/otp',
  'postgresql://postgres:secret@gateway.internal:5432/otp',
  'postgresql://observer%2Fadmin:secret@gateway.internal:5432/otp',
  'postgresql://:secret@gateway.internal:5432/otp',
 ]){
  assert.throws(()=>parseOtpGatewayStagingPreflightInputs(
   ['--staging-read-only'],
   {...valid,OTP_GATEWAY_MONITOR_DATABASE_URL:url},
  ),{message:'otp_gateway_staging_preflight_unavailable'});
 }
});

test('staging observer schema is validated before any database connection',()=>{
 for(const schema of [
  'information_schema','pg_catalog','pg_temp_1','pg_toast',
  'public;DROP TABLE otp_gateway_delivery_claims',
  'other.schema','otp-gateway','OTP_GATEWAY','a'.repeat(64),
  ' otp_gateway','otp_gateway ','', 'otp_gateway\\u0000',
 ]){
  assert.throws(()=>parseOtpGatewayStagingPreflightInputs(
   ['--staging-read-only'],
   {...valid,OTP_GATEWAY_MONITOR_SCHEMA:schema},
  ),{message:'otp_gateway_staging_preflight_unavailable'});
 }
 for(const schema of ['otp_gateway','gateway_2','_gateway']){
  assert.equal(parseOtpGatewayStagingPreflightInputs(
   ['--staging-read-only'],
   {...valid,OTP_GATEWAY_MONITOR_SCHEMA:schema},
  ).schema,schema);
 }
});

test('staging observer URL disallows connection option query and fragments',()=>{
 const base=valid.OTP_GATEWAY_MONITOR_DATABASE_URL;
 for(const suffix of [
  '?sslmode=disable','?sslmode=require','?options=-c%20search_path%3Dpublic',
  '?application_name=observer','?host=other.internal',
  '#ignored','#secret', '?sslmode=disable#fragment',
 ]){
  assert.throws(()=>parseOtpGatewayStagingPreflightInputs(
   ['--staging-read-only'],
   {...valid,OTP_GATEWAY_MONITOR_DATABASE_URL:base+suffix},
  ),{message:'otp_gateway_staging_preflight_unavailable'},suffix);
 }
 assert.equal(parseOtpGatewayStagingPreflightInputs(
  ['--staging-read-only'], valid,
 ).databaseUrl,base);
});


test('staging observer pins independently approved PostgreSQL port before connect',()=>{
 for(const approvedPort of ['0','0001','05432','65536','99999','-1',
  '+5432','5432 ',' 5432','5432/','5432;','abc','']){
  assert.throws(()=>parseOtpGatewayStagingPreflightInputs(
   ['--staging-read-only'],
   {...valid,OTP_GATEWAY_MONITOR_EXPECTED_PORT:approvedPort},
  ),{message:'otp_gateway_staging_preflight_unavailable'},approvedPort);
 }
 for(const url of [
  'postgresql://observer:secret@gateway.internal/otp',
  'postgresql://observer:secret@gateway.internal:5433/otp',
  'postgresql://observer:secret@gateway.internal:6543/otp',
  'postgresql://observer:secret@gateway.internal:05432/otp',
  'postgresql://observer:secret@gateway.internal:0005432/otp',
  'postgresql://observer:secret@gateway.internal:5432./otp',
 ]){
  assert.throws(()=>parseOtpGatewayStagingPreflightInputs(
   ['--staging-read-only'],
   {...valid,OTP_GATEWAY_MONITOR_DATABASE_URL:url},
  ),{message:'otp_gateway_staging_preflight_unavailable'});
 }
 assert.equal(parseOtpGatewayStagingPreflightInputs(
  ['--staging-read-only'],{
   ...valid,
   OTP_GATEWAY_MONITOR_EXPECTED_PORT:'6543',
   OTP_GATEWAY_MONITOR_DATABASE_URL:
    'postgresql://observer:secret@gateway.internal:6543/otp',
  },
 ).databaseName,'otp');
});
