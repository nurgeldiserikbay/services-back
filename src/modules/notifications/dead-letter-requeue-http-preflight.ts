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
 // Snapshot only own data properties. Never invoke attacker-controlled
 // getters or inherit a forged CSRF/transport value from a prototype.
 if(!input||typeof input!=='object')reject();
 const fields=[
  'deliveryId','requeueKeyHeader','rawBody','csrfHeader',
  'sessionExpectedCsrf','expectedOrigin','origin','fetchSite',
  'contentType','transportProtocol',
 ] as const;
 const data:Record<string,unknown>=Object.create(null);
 try{
  const prototype=Object.getPrototypeOf(input);
  if(prototype!==Object.prototype&&prototype!==null)reject();
  const descriptors=Object.getOwnPropertyDescriptors(input);
  const names=Reflect.ownKeys(descriptors);
  if(names.length!==fields.length||
     names.some(name=>typeof name!=='string'||
      !(fields as readonly string[]).includes(name)))reject();
  for(const field of fields){
   const descriptor=descriptors[field];
   if(!descriptor||!Object.hasOwn(descriptor,'value'))reject();
   data[field]=descriptor.value;
  }
 }catch{reject();}
 if(typeof data.deliveryId!=='string'||!UUID.test(data.deliveryId)||
    typeof data.requeueKeyHeader!=='string'||!UUID.test(data.requeueKeyHeader)||
    typeof data.rawBody!=='string'||
    Buffer.byteLength(data.rawBody,'utf8')>32||
    !/^[ \t\r\n]*\{[ \t\r\n]*\}[ \t\r\n]*$/.test(data.rawBody)||
    typeof data.expectedOrigin!=='string'||data.expectedOrigin.length>255||
    typeof data.origin!=='string'||data.origin.length>255||
    data.fetchSite!=='same-origin'||
    data.transportProtocol!=='https:'||
    typeof data.contentType!=='string'||
    !/^application\/json(?:;\s*charset=utf-8)?$/i.test(data.contentType))
  reject();
 let origin:URL;
 try{origin=new URL(data.expectedOrigin as string);}
 catch{reject();return undefined as never;}
 if(origin.protocol!=='https:'||origin.origin!==data.expectedOrigin||
    origin.username||origin.password||origin.pathname!=='/'||
    origin.search||origin.hash||data.origin!==origin.origin)
  reject();
 if(typeof data.csrfHeader!=='string'||
    typeof data.sessionExpectedCsrf!=='string'||
    !CSRF.test(data.csrfHeader)||!CSRF.test(data.sessionExpectedCsrf))
  reject();
 const a=Buffer.from(data.csrfHeader as string,'base64url');
 const b=Buffer.from(data.sessionExpectedCsrf as string,'base64url');
 if(a.length!==32||b.length!==32||
    a.toString('base64url')!==data.csrfHeader||
    b.toString('base64url')!==data.sessionExpectedCsrf||
    !timingSafeEqual(a,b))
  reject();
 // No user-supplied actor, organization scope, provider verdict or retry
 // state ever crosses this boundary.
 return Object.freeze({
  deliveryId:(data.deliveryId as string).toLowerCase(),
  requeueKey:(data.requeueKeyHeader as string).toLowerCase(),
 });
}
