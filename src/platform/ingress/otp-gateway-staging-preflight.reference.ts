import {isIP} from 'node:net';

const DENIED='otp_gateway_staging_preflight_unavailable';

export type OtpGatewayStagingPreflightInputs={
  databaseUrl:string;
  schema:string;
  caPem:string;
  databaseName:string;
};

/** Explicit opt-in to a read-only, reference-only staging connection.
 * This gate is not proof of environment identity or deployment approval.
 */
export function parseOtpGatewayStagingPreflightInputs(
  args:readonly string[],
  env:NodeJS.ProcessEnv,
):OtpGatewayStagingPreflightInputs{
  if(args.length!==1||args[0]!=='--staging-read-only'||
    env.OTP_GATEWAY_MONITOR_ENV!=='staging'||
    !env.OTP_GATEWAY_MONITOR_DATABASE_URL||
    !env.OTP_GATEWAY_MONITOR_SCHEMA||
    !env.OTP_GATEWAY_MONITOR_CA_PEM||
    !env.OTP_GATEWAY_MONITOR_EXPECTED_HOST||
    !env.OTP_GATEWAY_MONITOR_EXPECTED_DATABASE)
    throw new Error(DENIED);
  try{
    const host=env.OTP_GATEWAY_MONITOR_EXPECTED_HOST!;
    // Independent operator-approved DNS identity, not a value extracted
    // from the URL itself. Reject scheme, port, wildcard and IP literals.
    if(isIP(host)!==0||host.length>253||!/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(host)||
      host.split('.').some(label=>label.length>63||
        label.startsWith('-')||label.endsWith('-')))
      throw new Error(DENIED);
    const dbName=env.OTP_GATEWAY_MONITOR_EXPECTED_DATABASE!;
    if(!/^[a-z_][a-z0-9_]{0,62}$/.test(dbName)||
      dbName.startsWith('pg_')||dbName==='postgres'||
      dbName==='template0'||dbName==='template1')
      throw new Error(DENIED);
    const url=new URL(env.OTP_GATEWAY_MONITOR_DATABASE_URL);
    if(!['postgres:','postgresql:'].includes(url.protocol)||
      url.hostname!==host||url.pathname!=='/'+dbName)
      throw new Error(DENIED);
  }catch{
    // Credentials or attacker-controlled endpoint details are never logged.
    throw new Error(DENIED);
  }
  return {
    databaseUrl:env.OTP_GATEWAY_MONITOR_DATABASE_URL,
    schema:env.OTP_GATEWAY_MONITOR_SCHEMA,
    caPem:env.OTP_GATEWAY_MONITOR_CA_PEM,
    databaseName:env.OTP_GATEWAY_MONITOR_EXPECTED_DATABASE,
  };
}
