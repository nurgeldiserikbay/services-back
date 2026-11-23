const DENIED='otp_gateway_staging_preflight_unavailable';

export type OtpGatewayStagingPreflightInputs={
  databaseUrl:string;
  schema:string;
  caPem:string;
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
    !env.OTP_GATEWAY_MONITOR_CA_PEM)
    throw new Error(DENIED);
  return {
    databaseUrl:env.OTP_GATEWAY_MONITOR_DATABASE_URL,
    schema:env.OTP_GATEWAY_MONITOR_SCHEMA,
    caPem:env.OTP_GATEWAY_MONITOR_CA_PEM,
  };
}
