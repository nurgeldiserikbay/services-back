import {createServer, type Server} from 'node:https';
import type {IncomingMessage, ServerResponse} from 'node:http';
import {
  verifyOtpNodeMtlsPeerPins,
} from './otp-gateway-node-mtls.reference.js';

const FAIL='otp_gateway_request_rejected';
function deny():never{throw new Error(FAIL);}

type Pem=string|Buffer;
export type OtpGatewayMtlsReferenceServerConfig=Readonly<{
  key:Pem;
  cert:Pem;
  ca:Pem;
  /** Supply only from trusted operator configuration, never request headers. */
  approvedPins:()=>readonly string[];
}>;

/**
 * An explicitly UNWIRED, not-listening HTTPS server factory.
 * A deployment must independently ensure KZ residency, a private source
 * network, trusted CA and secrets rotation, provider egress and monitoring.
 * Never bind this server to public interfaces by default.
 *
 * TLS validates the client certificate chain, then the request callback
 * verifies the operator-approved SHA-256 pin before any application work.
 */
export function createOtpGatewayMtlsReferenceServer(
  config:OtpGatewayMtlsReferenceServerConfig,
  handleVerifiedRequest:(req:IncomingMessage,res:ServerResponse)=>void|Promise<void>,
):Server{
  const validPem=(value:unknown):value is Pem=>
    (typeof value==='string'&&value.length>0&&value.length<=65_536)||
    (Buffer.isBuffer(value)&&value.length>0&&value.length<=65_536);
  if(!config||!validPem(config.key)||!validPem(config.cert)||
     !validPem(config.ca)||typeof config.approvedPins!=='function'||
     typeof handleVerifiedRequest!=='function')deny();

  const server=createServer({
    key:config.key,cert:config.cert,ca:config.ca,
    requestCert:true,
    rejectUnauthorized:true,
    minVersion:'TLSv1.2',
    maxHeaderSize:4_096,
  },(req,res)=>{
    // Security boundary: do not use req.headers (coalesced) as peer identity.
    try{
      verifyOtpNodeMtlsPeerPins(req,config.approvedPins());
    }catch{
      if(!res.headersSent)res.writeHead(403,{
        'cache-control':'no-store','connection':'close',
      });
      res.end();
      return;
    }
    // Never surface a vendor error, OTP code or transport exception to client.
    try{
      void Promise.resolve(handleVerifiedRequest(req,res)).catch(()=>{
        if(!res.headersSent&&!res.destroyed){
          res.writeHead(503,{'cache-control':'no-store','connection':'close'});
          res.end();
        }else if(!res.destroyed)res.destroy();
      });
    }catch{
      if(!res.headersSent&&!res.destroyed){
        res.writeHead(503,{'cache-control':'no-store','connection':'close'});
        res.end();
      }else if(!res.destroyed)res.destroy();
    }
  });
  // Do not inherit Node's broad request-header and idle-socket budgets.
  server.maxHeadersCount=32;
  server.headersTimeout=5_000;
  server.requestTimeout=5_000;
  server.keepAliveTimeout=1_000;
  server.maxRequestsPerSocket=1;
  server.setTimeout(5_000,(socket)=>socket.destroy());
  return server;
}
