import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {test} from 'node:test';
import {parseOtpGatewayStagingPreflightInputs} from
 '../src/platform/ingress/otp-gateway-staging-preflight.reference.js';

const cli='scripts/otp-gateway-reservation-report.ts';
const denied='otp_gateway_operator_report_unavailable\n';
const env={
 PATH:process.env.PATH??'',
 HOME:process.env.HOME??'',
 OTP_GATEWAY_MONITOR_ENV:'staging',
 OTP_GATEWAY_MONITOR_EXPECTED_HOST:'gateway.internal',
 OTP_GATEWAY_MONITOR_EXPECTED_PORT:'5432',
 OTP_GATEWAY_MONITOR_EXPECTED_DATABASE:'gateway',
 OTP_GATEWAY_MONITOR_EXPECTED_ROLE:'observer',
 OTP_GATEWAY_MONITOR_DATABASE_URL:
  'postgresql://observer:PRIVATE_OPERATOR_TEST_PASSWORD@gateway.internal:5432/gateway',
 OTP_GATEWAY_MONITOR_SCHEMA:'gateway_ledger',
 OTP_GATEWAY_MONITOR_CA_PEM:'PRIVATE_OPERATOR_TEST_CA_PLACEHOLDER',
};
function deniedProcess(
 args:string[],environment:Record<string,string>,
):void{
 const result=spawnSync(process.execPath,['--import','tsx',cli,...args],{
  cwd:process.cwd(),env:environment,encoding:'utf8',
  timeout:12_000,maxBuffer:64*1024,
 });
 assert.equal(result.error,undefined);
 assert.equal(result.status,1);
 assert.equal(result.stdout,'');
 assert.equal(result.stderr,denied);
 for(const forbidden of [
  'PRIVATE_OPERATOR_TEST_PASSWORD','PRIVATE_OPERATOR_TEST_CA_PLACEHOLDER',
  'gateway.internal','gateway_ledger',
 ]){
  assert.ok(!result.stdout.includes(forbidden));
  assert.ok(!result.stderr.includes(forbidden));
 }
}

test('legacy OTP aggregate report fails closed without approved staging pins',()=>{
 deniedProcess([],{...env});
 deniedProcess(['--staging-read-only'],{...env});
 deniedProcess(['--read-only'],{...env,OTP_GATEWAY_MONITOR_ENV:'production'});
 deniedProcess(['--read-only'],{...env,OTP_GATEWAY_MONITOR_EXPECTED_PORT:''});
 deniedProcess(['--read-only'],{...env,OTP_GATEWAY_MONITOR_EXPECTED_HOST:'other.internal'});
 deniedProcess(['--read-only'],{...env,OTP_GATEWAY_MONITOR_EXPECTED_ROLE:'admin'});
 deniedProcess(['--read-only'],{...env,OTP_GATEWAY_MONITOR_EXPECTED_DATABASE:'services'});
 deniedProcess(['--read-only'],{
  ...env,
  OTP_GATEWAY_MONITOR_DATABASE_URL:
   'postgresql://observer:PRIVATE_OPERATOR_TEST_PASSWORD@gateway.internal:5433/gateway',
 });
});

test('legacy aggregate CLI reaches the CA validation boundary without network',()=>{
 // A valid identity fixture means the invalid CA (rather than a missing
 // identity pin) causes the sanitized process-level refusal.
 assert.equal(parseOtpGatewayStagingPreflightInputs(
  ['--staging-read-only'],env,
 ).roleName,'observer');
 deniedProcess(['--read-only'],{...env});
});
