import {isIP} from 'node:net';
import type {ReceiverMonitorBreach}
 from './external-delivery-alert-receiver-monitor-policy.js';
import type {ReceiverMonitoringTransport}
 from './external-delivery-alert-receiver-monitor-dispatch.js';

export type ReceiverMonitorHttpsConfig=Readonly<{
 endpoint:string;
 approvedHostname:string;
 bearerToken:string;
 timeoutMs:number;
}>;

const CODES=new Set([
 'RETRY_BACKLOG','EXPIRED_LEASES','TERMINAL_FAILURES','INCONSISTENT_STATE',
]);
const fail=():never=>{
 throw new Error('invalid_external_alert_receiver_https_transport');
};

/**
 * A caller-owned opt-in HTTPS adapter. Never configured by default, registered
 * as a job, exposed as an endpoint or instantiated by the monitoring module.
 * The operator must approve the exact HTTPS hostname and provide a secret.
 */
export function createReceiverMonitorHttpsTransport(
 config:ReceiverMonitorHttpsConfig,
 request:typeof fetch=fetch,
):ReceiverMonitoringTransport{
 if(!config||typeof config!=='object'||Array.isArray(config))fail();
 const fields=['endpoint','approvedHostname','bearerToken','timeoutMs'];
 const keys=Reflect.ownKeys(config);
 if(keys.length!==fields.length||keys.some(k=>typeof k!=='string'||!fields.includes(k)))fail();
 const values=fields.map(k=>{
  const d=Object.getOwnPropertyDescriptor(config,k);
  if(!d)return fail();
  if(!Object.hasOwn(d,'value'))return fail();
  return d.value as unknown;
 });
 const [endpoint,approvedHostname,bearerToken,timeoutMs]=values;
 if(typeof endpoint!=='string'||typeof approvedHostname!=='string'||
    typeof bearerToken!=='string'||typeof timeoutMs!=='number'||
    !Number.isSafeInteger(timeoutMs)||timeoutMs<1000||timeoutMs>10000||
    bearerToken.length<32||bearerToken.length>2048||
    !/^[\x21-\x7E]+$/.test(bearerToken))fail();
 if(typeof endpoint!=='string')return fail();
 if(typeof approvedHostname!=='string')return fail();
 if(typeof bearerToken!=='string')return fail();
 if(typeof timeoutMs!=='number')return fail();
 if(typeof request!=='function')return fail();
 let uri:URL;
 try{uri=new URL(endpoint);}catch{return fail();}
 if(uri.protocol!=='https:'||uri.username||uri.password||uri.hash||
    uri.search||uri.port&&uri.port!=='443'||uri.hostname!==approvedHostname||
    !/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,63}$/.test(approvedHostname)||
    approvedHostname.includes('..')||approvedHostname.endsWith('.local')||
    isIP(approvedHostname)!==0)fail();
 // Only the validated non-sensitive fields enter the serialized body.
 return Object.freeze({send:async(breaches:readonly ReceiverMonitorBreach[])=>{
  if(!Array.isArray(breaches)||breaches.length<1||breaches.length>4)fail();
  const sanitized=breaches.map(b=>{
   if(!b||typeof b!=='object'||Array.isArray(b))fail();
   const props=Reflect.ownKeys(b);
   if(props.length!==3||props.some(p=>typeof p!=='string'||
    !['code','observed','threshold'].includes(p)))fail();
   const values=['code','observed','threshold'].map(k=>{
    const d=Object.getOwnPropertyDescriptor(b,k);
    if(!d)return fail();
    if(!Object.hasOwn(d,'value'))return fail();
    return d.value as unknown;
   });
   const [code,observed,threshold]=values;
   if(typeof code!=='string')return fail();
   if(typeof observed!=='number')return fail();
   if(typeof threshold!=='number')return fail();
   if(!CODES.has(code)||!Number.isSafeInteger(observed)||observed<0||
      !Number.isSafeInteger(threshold)||threshold<1||observed<threshold)fail();
   return {code,observed,threshold};
  });
  // The request is bounded, denies redirects, and never exposes provider bodies.
  try{
   const response=await request(uri.toString(),{
    method:'POST',
    headers:{
     'content-type':'application/json',
     'authorization':`Bearer ${bearerToken}`,
    },
    body:JSON.stringify({breaches:sanitized}),
    redirect:'error',
    signal:AbortSignal.timeout(timeoutMs),
   });
   if(!response.ok)throw new Error('receiver_monitor_https_delivery_failed');
  }catch{
   throw new Error('receiver_monitor_https_delivery_failed');
  }
 }});
}
