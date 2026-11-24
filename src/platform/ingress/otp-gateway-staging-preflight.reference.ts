import {isIP} from 'node:net';

const DENIED='otp_gateway_staging_preflight_unavailable';

export type OtpGatewayStagingPreflightInputs={
  databaseUrl:string;
  schema:string;
  caPem:string;
  databaseName:string;
  roleName:string;
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
    !env.OTP_GATEWAY_MONITOR_EXPECTED_PORT||
    !env.OTP_GATEWAY_MONITOR_EXPECTED_DATABASE||
    !env.OTP_GATEWAY_MONITOR_EXPECTED_ROLE)
    throw new Error(DENIED);
  try{
    const host=env.OTP_GATEWAY_MONITOR_EXPECTED_HOST!;
    // Independent operator-approved DNS identity, not a value extracted
    // from the URL itself. Reject scheme, port, wildcard and IP literals.
    if(isIP(host)!==0||host.length>253||!/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(host)||
      host.split('.').some(label=>label.length>63||
        label.startsWith('-')||label.endsWith('-')))
      throw new Error(DENIED);
    // Port must be separately approved; no implicit 5432 or URL-controlled
    // alternate listener is accepted by the staging-only monitor.
    const port=env.OTP_GATEWAY_MONITOR_EXPECTED_PORT!;
    if(!/^[1-9][0-9]{0,4}$/.test(port)||Number(port)>65535)
      throw new Error(DENIED);
    const dbName=env.OTP_GATEWAY_MONITOR_EXPECTED_DATABASE!;
    if(!/^[a-z_][a-z0-9_]{0,62}$/.test(dbName)||
      dbName.startsWith('pg_')||dbName==='postgres'||
      dbName==='template0'||dbName==='template1')
      throw new Error(DENIED);
    const role=env.OTP_GATEWAY_MONITOR_EXPECTED_ROLE!;
    if(!/^[a-z_][a-z0-9_]{0,62}$/.test(role)||
      role.startsWith('pg_')||role==='postgres')
      throw new Error(DENIED);
    // Fail before opening a network connection. Previously an invalid schema
    // reached Pool.connect() and was rejected only inside the report runner.
    const schema=env.OTP_GATEWAY_MONITOR_SCHEMA!;
    if(!/^[a-z_][a-z0-9_]{0,62}$/.test(schema)||
      schema.startsWith('pg_')||schema==='information_schema')
      throw new Error(DENIED);
    // WHATWG URL normalizes ports such as :05432 to :5432. Check the
    // literal authority first so the operator-approved endpoint remains
    // canonical, and an implicit or noncanonical port cannot be hidden.
    const rawAuthority=env.OTP_GATEWAY_MONITOR_DATABASE_URL!.match(
      /^postgres(?:ql)?:\/\/([^/?#]+)\//,
    )?.[1];
    const rawEndpoint=rawAuthority?.slice(rawAuthority.lastIndexOf('@')+1);
    if(rawEndpoint!==host+':'+port)throw new Error(DENIED);
    const url=new URL(env.OTP_GATEWAY_MONITOR_DATABASE_URL);
    if(!['postgres:','postgresql:'].includes(url.protocol)||
      url.hostname!==host||url.port!==port||url.pathname!=='/'+dbName||
      url.username!==role||url.search!==''||url.hash!=='')
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
    roleName:env.OTP_GATEWAY_MONITOR_EXPECTED_ROLE,
  };
}
