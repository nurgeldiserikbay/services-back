import {Pool} from 'pg';
import {makeOtpGatewayMonitorPoolConfig} from
 '../src/platform/ingress/otp-gateway-monitor-tls.reference.js';
import {runOtpGatewayOperatorReportReadOnly} from
 '../src/platform/ingress/otp-gateway-operator-report.reference.js';
import {parseOtpGatewayStagingPreflightInputs} from
 '../src/platform/ingress/otp-gateway-staging-preflight.reference.js';

/**
 * Manual, single-shot, aggregate-only reference CLI. Do not schedule,
 * deploy or invoke on the main Services/Prisma database. Use a dedicated,
 * restricted gateway observer credential inside the approved private network.
 *
 * Example (from a controlled operator terminal):
 * OTP_GATEWAY_MONITOR_SCHEMA=<approved-gateway-ledger-schema> \
 * OTP_GATEWAY_MONITOR_DATABASE_URL=<from-secret-manager> \
 *   node --import tsx scripts/otp-gateway-reservation-report.ts --read-only
 */
async function main():Promise<void>{
  // Legacy aggregate reporting must not bypass the staging observer's
  // independently approved host/port/database/role/schema identity gate.
  // Keep the explicit legacy --read-only operator command, but require
  // precisely the same staging environment and fail-closed preflight.
  if(process.argv.length!==3||process.argv[2]!=='--read-only')
    throw new Error('disabled');
  const inputs=parseOtpGatewayStagingPreflightInputs(
    ['--staging-read-only'],process.env,
  );
  const pool=new Pool(makeOtpGatewayMonitorPoolConfig(
    inputs.databaseUrl,inputs.caPem,
  ));
  try{
    const snapshot=await runOtpGatewayOperatorReportReadOnly(
      pool,inputs.schema,true,inputs.databaseName,inputs.roleName,
    );
    process.stdout.write(JSON.stringify(snapshot)+'\n');
  }finally{
    await pool.end();
  }
}
main().catch(()=>{
  // No SQL exceptions, database credentials or raw OTP payloads on stderr.
  process.stderr.write('otp_gateway_operator_report_unavailable\n');
  process.exitCode=1;
});
