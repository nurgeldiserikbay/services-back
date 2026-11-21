import {readBoundedOtpGatewayBody} from './otp-gateway-bounded-body.reference.js';
import {
  verifyTrustedOtpGatewayHttpEnvelope,
  type TrustedOtpGatewayIngressConfig,
  type VerifiedOtpGatewayPayload,
} from './otp-gateway-verified-request.reference.js';
import {
  OtpGatewayLedgerDispatchReference,
  type OtpGatewayDispatchResult,
  type OtpGatewayVendorPort,
} from './otp-gateway-ledger-dispatch.reference.js';

const DENY='otp_gateway_request_rejected';
function deny():never{throw new Error(DENY);}

/**
 * Reject obviously invalid request headers before reading body chunks.
 * Full raw-header validation, BFF authentication, canonical JSON and HMAC
 * are still mandatory in verifyTrustedOtpGatewayHttpEnvelope after reading.
 * Do not treat this preliminary check as authorization.
 */
function preflightHeaders(rawHeaders:readonly (readonly [string,string])[]):void{
  if(!Array.isArray(rawHeaders)||rawHeaders.length>32)deny();
  const required=new Set([
    'authorization','idempotency-key',
    'x-services-otp-payload-fingerprint','content-type','content-length',
  ]);
  const counts=new Map<string,number>();
  for(const entry of rawHeaders){
    if(!Array.isArray(entry)||entry.length!==2||
       typeof entry[0]!=='string'||typeof entry[1]!=='string')deny();
    const [rawName,value]=entry;
    if(!/^[A-Za-z0-9!#$%&'*+.^_\\x60|~-]+$/.test(rawName)||
       value.length>1024||/[\\r\\n]/.test(value))deny();
    const name=rawName.toLowerCase();
    if(name==='transfer-encoding'||name==='content-encoding')deny();
    if(required.has(name)){
      const count=(counts.get(name)??0)+1;
      if(count>1)deny();
      counts.set(name,count);
    }
    if(name==='content-length'&&
       (!/^(0|[1-9][0-9]*)$/.test(value)||
        Number(value)<1||Number(value)>1024))deny();
    if(name==='content-type'&&value!=='application/json')deny();
  }
  for(const name of required)if(counts.get(name)!==1)deny();
}

/**
 * Reference-only composition for a future private gateway HTTP listener.
 * Check streaming byte bound, raw method/path/header multiplicity, canonical
 * payload, trusted BFF bearer and HMAC BEFORE creating a vendor or claiming a
 * durable idempotency reservation. Do not wire this into Nest or production.
 * The listener must enforce real socket deadlines/TLS/mTLS and KZ residency.
 */
export async function dispatchBoundedOtpGatewayHttpStream(
  method:string,
  requestTarget:string,
  rawHeaders:readonly (readonly [string,string])[],
  stream:AsyncIterable<Buffer>,
  config:TrustedOtpGatewayIngressConfig,
  gateway:OtpGatewayLedgerDispatchReference,
  makeVendor:(payload:VerifiedOtpGatewayPayload)=>OtpGatewayVendorPort,
  signal?:AbortSignal,
):Promise<OtpGatewayDispatchResult>{
  // Cheap routing preflight must deny wrong endpoints before consuming a stream.
  if(signal?.aborted||method!=='POST'||requestTarget!=='/v1/send')deny();
  preflightHeaders(rawHeaders);
  const bytes=await readBoundedOtpGatewayBody(stream,signal);
  const request=verifyTrustedOtpGatewayHttpEnvelope(
    method,requestTarget,rawHeaders,bytes,config,
  );
  if(signal?.aborted)deny();
  const vendor=makeVendor(request.payload);
  return gateway.dispatch({
    idempotencyKey:request.idempotencyKey,
    fingerprint:request.fingerprint,
  },vendor,signal);
}
