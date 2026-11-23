import {Pool} from 'pg';
import {runOtpGatewayOperatorReportReadOnly} from
 '../src/platform/ingress/otp-gateway-operator-report.reference.js';

/**
 * Manual, single-shot, aggregate-only reference CLI. Do not schedule,
 * deploy or invoke on the main Services/Prisma database. Use a dedicated,
 * restricted gateway observer credential inside the approved private network.
 *
 * Example (from a controlled operator terminal):
 * OTP_GATEWAY_MONITOR_DATABASE_URL=<from-secret-manager> \
 *   node --import tsx scripts/otp-gateway-reservation-report.ts --read-only
 */
async function main():Promise<void>{
  if(process.argv.length!==3||process.argv[2]!=='--read-only'||
    !process.env.OTP_GATEWAY_MONITOR_DATABASE_URL)
    throw new Error('disabled');
  const pool=new Pool({
    connectionString:process.env.OTP_GATEWAY_MONITOR_DATABASE_URL,
    max:1,
    connectionTimeoutMillis:5_000,
    idleTimeoutMillis:1_000,
    query_timeout:5_000,
  });
  try{
    const snapshot=await runOtpGatewayOperatorReportReadOnly(pool);
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
