import {timingSafeEqual} from 'node:crypto';

/**
 * Pure contract for a FUTURE privileged notification-requeue HTTP adapter.
 * No route is registered here; this parser never authenticates or touches DB.
 *
 * The future adapter MUST take expectedOrigin and transportProtocol from
 * trusted server/ingress settings, and expectedCsrf from an authenticated
 * session. Never derive those from Host/X-Forwarded-* or client headers.
 * The organization scope MUST come from the authorized server principal.
 */
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CSRF=/^[A-Za-z0-9_-]{43}$/;
export class RequeueHttpPreflightRejected extends Error {
 constructor(){super('invalid_requeue_http_preflight');}
}
export type RequeueHttpCommand=Readonly<{
 deliveryId:string;
 requeueKey:string;
}>;
export function parseRequeueHttpPreflight(input:Readonly<{
 deliveryId:unknown;
 requeueKeyHeader:unknown;
 rawBody:unknown;
 csrfHeader:unknown;
 sessionExpectedCsrf:unknown;
 expectedOrigin:unknown;
 origin:unknown;
 fetchSite:unknown;
 contentType:unknown;
 transportProtocol:unknown;
}>):RequeueHttpCommand{
 const reject=():never=>{throw new RequeueHttpPreflightRejected();};
 if(!input||typeof input!=='object'||
    typeof input.deliveryId!=='string'||!UUID.test(input.deliveryId)||
    typeof input.requeueKeyHeader!=='string'||!UUID.test(input.requeueKeyHeader)||
    typeof input.rawBody!=='string'||
    Buffer.byteLength(input.rawBody,'utf8')>32||
    !/^[ \t\r\n]*\{[ \t\r\n]*\}[ \t\r\n]*$/.test(input.rawBody)||
    typeof input.expectedOrigin!=='string'||input.expectedOrigin.length>255||
    typeof input.origin!=='string'||input.origin.length>255||
    input.fetchSite!=='same-origin'||
    input.transportProtocol!=='https:'||
    typeof input.contentType!=='string'||
    !/^application\/json(?:;\s*charset=utf-8)?$/i.test(input.contentType))
  reject();
 let origin:URL;
 try{origin=new URL(input.expectedOrigin);}
 catch{reject();return undefined as never;}
 if(origin.protocol!=='https:'||origin.origin!==input.expectedOrigin||
    origin.username||origin.password||origin.pathname!=='/'||
    origin.search||origin.hash||input.origin!==origin.origin)
  reject();
 if(typeof input.csrfHeader!=='string'||
    typeof input.sessionExpectedCsrf!=='string'||
    !CSRF.test(input.csrfHeader)||!CSRF.test(input.sessionExpectedCsrf))
  reject();
 const a=Buffer.from(input.csrfHeader,'base64url');
 const b=Buffer.from(input.sessionExpectedCsrf,'base64url');
 if(a.length!==32||b.length!==32||
    a.toString('base64url')!==input.csrfHeader||
    b.toString('base64url')!==input.sessionExpectedCsrf||
    !timingSafeEqual(a,b))
  reject();
 // No user-supplied actor, organization scope, provider verdict or retry
 // state ever crosses this boundary.
 return Object.freeze({
  deliveryId:input.deliveryId.toLowerCase(),
  requeueKey:input.requeueKeyHeader.toLowerCase(),
 });
}
