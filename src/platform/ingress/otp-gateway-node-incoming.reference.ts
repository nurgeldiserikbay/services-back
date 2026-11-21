import type {IncomingMessage} from 'node:http';
import {otpNodeRawHeaderPairs} from './otp-gateway-node-rawheaders.reference.js';
import {
  dispatchBoundedOtpGatewayHttpStream,
} from './otp-gateway-stream-dispatch.reference.js';
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
function reject():never{throw new Error(FAIL);}

/**
 * UNWIRED Node IncomingMessage reference adapter. It does not create or
 * register any HTTP server or authorize a network peer. A deployable gateway
 * must terminate approved TLS/mTLS and enforce private-network source policy
 * before invoking this adapter. Never trust forwarding headers for identity.
 */
export async function dispatchOtpNodeIncomingMessage(
  request:IncomingMessage,
  config:TrustedOtpGatewayIngressConfig,
  gateway:OtpGatewayLedgerDispatchReference,
  makeVendor:(payload:VerifiedOtpGatewayPayload)=>OtpGatewayVendorPort,
  deadlineMs=5_000,
  externalSignal?:AbortSignal,
):Promise<OtpGatewayDispatchResult>{
  if(!request||!Number.isSafeInteger(deadlineMs)||
     deadlineMs<10||deadlineMs>30_000||externalSignal?.aborted)
    reject();
  const method=request.method;
  const requestTarget=request.url;
  if(method!=='POST'||requestTarget!=='/v1/send')reject();
  // Use the original wire-level pairs, not request.headers or Headers().
  const pairs=otpNodeRawHeaderPairs(request.rawHeaders);
  const abort=new AbortController();
  const onAborted=()=>abort.abort();
  const onExternalAbort=()=>abort.abort();
  request.once('aborted',onAborted);
  externalSignal?.addEventListener('abort',onExternalAbort,{once:true});
  const onAbort=()=>request.destroy();
  abort.signal.addEventListener('abort',onAbort,{once:true});
  const timer=setTimeout(()=>abort.abort(),deadlineMs);
  try{
    if(request.aborted||externalSignal?.aborted)reject();
    return await dispatchBoundedOtpGatewayHttpStream(
      method,requestTarget,pairs,request,config,gateway,makeVendor,
      abort.signal,deadlineMs,
    );
  }finally{
    clearTimeout(timer);
    request.removeListener('aborted',onAborted);
    externalSignal?.removeEventListener('abort',onExternalAbort);
    abort.signal.removeEventListener('abort',onAbort);
  }
}
