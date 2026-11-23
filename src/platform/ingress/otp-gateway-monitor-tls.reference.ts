import type {PoolConfig} from 'pg';

const DENIED='otp_gateway_operator_report_unavailable';

/**
 * Reference-only monitor connection configuration. Never fall back to
 * libpq PGSSL* environment defaults, URL sslmode parameters or system trust.
 * The approved gateway CA is delivered by the operator's secret manager.
 * This does not provision certificates or approve a production endpoint.
 */
export function makeOtpGatewayMonitorPoolConfig(
  connectionString:string|undefined,
  caPem:string|undefined,
):PoolConfig{
  try{
    if(!connectionString||!caPem)throw new Error(DENIED);
    const url=new URL(connectionString);
    if(!['postgres:','postgresql:'].includes(url.protocol)||
      !url.hostname||!url.username||url.search||url.hash)
      throw new Error(DENIED);
    // Sanity check only: actual certificate-chain and hostname verification
    // are performed by Node TLS when the PostgreSQL connection is opened.
    if(!/-----BEGIN CERTIFICATE-----[\s\S]+-----END CERTIFICATE-----/.test(caPem))
      throw new Error(DENIED);
    return {
      connectionString,
      ssl:{ca:caPem,rejectUnauthorized:true,minVersion:'TLSv1.2'},
      max:1,
      connectionTimeoutMillis:5_000,
      idleTimeoutMillis:1_000,
      query_timeout:5_000,
    };
  }catch{
    // Never surface credentials, connection strings, SQL or TLS diagnostics.
    throw new Error(DENIED);
  }
}
