import {timingSafeEqual} from 'node:crypto';
import type {IncomingMessage} from 'node:http';
import {TLSSocket} from 'node:tls';
import {
  dispatchOtpNodeIncomingMessage,
} from './otp-gateway-node-incoming.reference.js';
import type {
  TrustedOtpGatewayIngressConfig,
  VerifiedOtpGatewayPayload,
} from './otp-gateway-verified-request.reference.js';
import type {
  OtpGatewayDispatchResult,
  OtpGatewayVendorPort,
  OtpGatewayLedgerDispatchReference,
} from './otp-gateway-ledger-dispatch.reference.js';

const FAIL='otp_gateway_request_rejected';
function deny():never{throw new Error(FAIL);}

/**
 * Reference-only mTLS client certificate pin gate for a future private HTTP
 * listener. Require a real Node TLSSocket already authenticated by TLS
 * verification, then independently pin its peer certificate SHA-256 digest.
 *
 * Production listener MUST set requestCert:true and rejectUnauthorized:true,
 * validate the certificate chain and trust anchors, enforce private-network
 * access/KZ residency and prevent untrusted forwarding proxies from
 * supplying fake identity. This helper never starts a listener.
 */
export function verifyOtpNodeMtlsPeer(
  request:IncomingMessage,
  approvedPeerFingerprintSha256:string,
):void{
  try{
    if(typeof approvedPeerFingerprintSha256!=='string'||
       !/^[0-9a-f]{64}$/.test(approvedPeerFingerprintSha256))deny();
    const socket=request.socket;
    if(!(socket instanceof TLSSocket)||!socket.encrypted||
       socket.authorized!==true||socket.authorizationError)deny();
    const certificate=socket.getPeerCertificate();
    if(!certificate||typeof certificate.fingerprint256!=='string'||
       !/^(?:[0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(
         certificate.fingerprint256))deny();
    const actual=Buffer.from(certificate.fingerprint256.replace(/:/g,'').toLowerCase(),'hex');
    const approved=Buffer.from(approvedPeerFingerprintSha256,'hex');
    if(actual.length!==32||approved.length!==32||
       !timingSafeEqual(actual,approved))deny();
  }catch{deny();}
}

/**
 * Strict trust entrypoint: do not consume a body or claim idempotency before
 * validating the authenticated client certificate. Still reference-only.
 */
export async function dispatchMtlsOtpNodeIncomingMessage(
  request:IncomingMessage,
  approvedPeerFingerprintSha256:string,
  config:TrustedOtpGatewayIngressConfig,
  gateway:OtpGatewayLedgerDispatchReference,
  makeVendor:(payload:VerifiedOtpGatewayPayload)=>OtpGatewayVendorPort,
  deadlineMs=5_000,
  externalSignal?:AbortSignal,
):Promise<OtpGatewayDispatchResult>{
  verifyOtpNodeMtlsPeer(request,approvedPeerFingerprintSha256);
  return dispatchOtpNodeIncomingMessage(
    request,config,gateway,makeVendor,deadlineMs,externalSignal,
  );
}
