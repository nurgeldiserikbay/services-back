import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {test} from 'node:test';

const cli='scripts/otp-gateway-staging-preflight.ts';
const denied='otp_gateway_staging_preflight_unavailable\n';
// These are nonsecret disposable values. No live endpoint is used.
// Tests must fail before any network access, regardless of CI environment.
const baseEnv={
 PATH:process.env.PATH??'',
 HOME:process.env.HOME??'',
 OTP_GATEWAY_MONITOR_ENV:'staging',
 OTP_GATEWAY_MONITOR_EXPECTED_HOST:'gateway.internal',
 OTP_GATEWAY_MONITOR_DATABASE_URL:
  'postgresql://observer:PRIVATE_TEST_PASSWORD@gateway.internal:5432/gateway',
 OTP_GATEWAY_MONITOR_SCHEMA:'private_test_schema_identifier',
 OTP_GATEWAY_MONITOR_CA_PEM:'PRIVATE_TEST_CA_PLACEHOLDER',
};
function probe(
 args:string[],
 env:Record<string,string>,
){
 const result=spawnSync(process.execPath,['--import','tsx',cli,...args],{
  cwd:process.cwd(),
  env,
  encoding:'utf8',
  timeout:12_000,
  maxBuffer:64*1024,
 });
 assert.equal(result.error,undefined);
 assert.equal(result.status,1);
 assert.equal(result.stdout,'');
 assert.equal(result.stderr,denied);
 for(const secret of ['PRIVATE_TEST_PASSWORD','PRIVATE_TEST_CA_PLACEHOLDER',
  'gateway.internal','private_test_schema_identifier']){
  assert.ok(!result.stdout.includes(secret));
  assert.ok(!result.stderr.includes(secret));
 }
}

test('OTP staging CLI exposes only sanitized error for forbidden invocations',()=>{
 probe([],{...baseEnv});
 probe(['--read-only'],{...baseEnv});
 probe(['--staging-read-only'],{
  ...baseEnv,OTP_GATEWAY_MONITOR_ENV:'production',
 });
 probe(['--staging-read-only'],{
  ...baseEnv,OTP_GATEWAY_MONITOR_EXPECTED_HOST:'other.internal',
 });
});

test('OTP staging CLI hides invalid secret/CA diagnostics on actual process exit',()=>{
 probe(['--staging-read-only'],{...baseEnv});
 // URL validation rejects before Pool creation even with a valid-looking CA.
 probe(['--staging-read-only'],{
  ...baseEnv,
  OTP_GATEWAY_MONITOR_DATABASE_URL:
   'postgresql://observer:PRIVATE_TEST_PASSWORD@other.internal:5432/gateway',
 });
});
