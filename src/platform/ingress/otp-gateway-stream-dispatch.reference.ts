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
