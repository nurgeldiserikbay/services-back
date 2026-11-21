import type {IncomingMessage,ServerResponse} from 'node:http';
import {
  dispatchOtpNodeIncomingMessage,
} from './otp-gateway-node-incoming.reference.js';
import type {
  TrustedOtpGatewayIngressConfig,
  VerifiedOtpGatewayPayload,
} from './otp-gateway-verified-request.reference.js';
import type {
  OtpGatewayLedgerDispatchReference,
  OtpGatewayVendorPort,
} from './otp-gateway-ledger-dispatch.reference.js';

/**
 * Reference-only handler intended ONLY as the callback to the mTLS server
 * factory, which verifies the real client TLS certificate and approved pin
 * before invoking it. Do not register this handler on a public or Nest route.
 * Production deployment must additionally enforce private KZ-hosted ingress,
 * approved provider egress and durable PostgreSQL ledger semantics.
 */
export function createOtpGatewayReferenceHttpHandler(
  config:TrustedOtpGatewayIngressConfig,
  gateway:OtpGatewayLedgerDispatchReference,
  makeVendor:(payload:VerifiedOtpGatewayPayload)=>OtpGatewayVendorPort,
  deadlineMs=5_000,
):(request:IncomingMessage,response:ServerResponse)=>Promise<void>{
  if(!config||!gateway||typeof makeVendor!=='function'||
     !Number.isSafeInteger(deadlineMs)||deadlineMs<10||deadlineMs>30_000)
    throw new Error('otp_gateway_request_rejected');
  return async(request,response)=>{
    const headers={
      'cache-control':'no-store',
      'content-type':'application/json',
      'x-content-type-options':'nosniff',
      'connection':'close',
    } as const;
    const reply=(status:number,body:string):void=>{
      if(response.destroyed||response.writableEnded)return;
      if(response.headersSent){response.destroy();return;}
      response.writeHead(status,{
        ...headers,'content-length':String(Buffer.byteLength(body)),
      });
      response.end(body);
    };
    // Route rejection is independent of OTP body parsing and vendor dispatch.
    if(request.method!=='POST'||request.url!=='/v1/send'){
      reply(404,'{"accepted":false}');
      return;
    }
    try{
      const result=await dispatchOtpNodeIncomingMessage(
        request,config,gateway,makeVendor,deadlineMs,
      );
      if(result.status==='accepted'){
        // Only release the sanitized receipt once the durable ledger confirms it.
        reply(202,JSON.stringify({
          accepted:true,providerRef:result.providerRef,
        }));
      }else{
        // Conflict and ambiguous in-flight delivery are never treated as
        // success, and never automatically retried by the gateway.
        reply(409,'{"accepted":false}');
      }
    }catch{
      // Never echo raw request content, OTP, secrets, vendor or SQL errors.
      reply(503,'{"accepted":false}');
    }
  };
}
