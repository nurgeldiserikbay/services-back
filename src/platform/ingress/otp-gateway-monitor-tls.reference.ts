import {X509Certificate} from 'node:crypto';
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
  globalTlsVerification:string|undefined=process.env.NODE_TLS_REJECT_UNAUTHORIZED,
):PoolConfig{
  try{
    if(!connectionString||!caPem)throw new Error(DENIED);
    const url=new URL(connectionString);
    if(!['postgres:','postgresql:'].includes(url.protocol)||
      !url.hostname||!url.username||url.search||url.hash)
      throw new Error(DENIED);
    // NODE_TLS_REJECT_UNAUTHORIZED=0 disables verification process-wide,
    // even if rejectUnauthorized is set on an individual client.
    if(globalTlsVerification==='0')throw new Error(DENIED);
    // Parse the COMPLETE bounded PEM bundle, not just matching delimiters.
    // A placeholder, expired CA or trailing garbage cannot act as trust.
    if(caPem.length>131_072)throw new Error(DENIED);
    const blocks=caPem.match(/-----BEGIN CERTIFICATE-----[\\s\\S]*?-----END CERTIFICATE-----/g);
    if(!blocks||blocks.length===0||blocks.length>8||
      caPem.replace(/-----BEGIN CERTIFICATE-----[\\s\\S]*?-----END CERTIFICATE-----/g,'').trim())
      throw new Error(DENIED);
    const now=Date.now();
    for(const block of blocks){
      const cert=new X509Certificate(block);
      const notBefore=Date.parse(cert.validFrom);
      const notAfter=Date.parse(cert.validTo);
      if(!cert.ca||!Number.isFinite(notBefore)||!Number.isFinite(notAfter)||
        now<notBefore||now>=notAfter)throw new Error(DENIED);
    }
    // Certificate chain and hostname validation still happen on connect.
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
