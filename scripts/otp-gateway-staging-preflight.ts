import {Pool} from 'pg';
import {makeOtpGatewayMonitorPoolConfig} from
 '../src/platform/ingress/otp-gateway-monitor-tls.reference.js';
import {parseOtpGatewayStagingPreflightInputs} from
 '../src/platform/ingress/otp-gateway-staging-preflight.reference.js';
import {runOtpGatewayOperatorReportReadOnly} from
 '../src/platform/ingress/otp-gateway-operator-report.reference.js';

/**
 * Operator-invoked staging-only, single-shot and read-only preflight.
 * Must NOT run against the Services/Prisma DB or from public CI runners.
 * This verifies PostgreSQL SSL on the same connection as role ACL/aggregate
 * checks, but cannot approve private network placement or provider delivery.
 */
async function main():Promise<void>{
  const inputs=parseOtpGatewayStagingPreflightInputs(
    process.argv.slice(2),process.env,
  );
  const pool=new Pool(makeOtpGatewayMonitorPoolConfig(
    inputs.databaseUrl,inputs.caPem,
  ));
  try{
    await runOtpGatewayOperatorReportReadOnly(
      pool,inputs.schema,true,inputs.databaseName,
    );
    // No DB name, schema, role, hostname, metrics, identifiers or secrets.
    process.stdout.write(
      '{"observerTlsAndAcl":"pass","productionApproved":false}\n',
    );
  }finally{
    await pool.end();
  }
}
main().catch(()=>{
  process.stderr.write('otp_gateway_staging_preflight_unavailable\n');
  process.exitCode=1;
});
