import {isIP} from 'node:net';
import {createHash} from 'node:crypto';
import type {ExternalDeliveryAlert} from './external-delivery-alerts.js';
import type {ExternalDeliveryAlertTransport}
 from './external-delivery-alert-dispatch.js';

/**
 * Opt-in HTTPS delivery adapter for an operator-approved alert receiver.
 * Not wired into runtime, scheduler, public routes or environment defaults.
 * A deployment owner must approve the receiver hostname and provide its token.
 * The receiver itself is responsible for deduplication and alert lifecycle.
 */
export type ExternalDeliveryWebhookConfig=Readonly<{
 endpoint:string;
 approvedHostname:string;
 bearerToken:string;
 timeoutMs:number;
 /** Optional approved bucket for receiver-side idempotency, 60s–1h. */
 idempotencyWindowMs?:number;
}>;

export function createExternalDeliveryWebhookTransport(
 config:ExternalDeliveryWebhookConfig,
 request:typeof fetch=fetch,
 clock:()=>number=Date.now,
):ExternalDeliveryAlertTransport{
 if(!config||typeof config!=='object')
  throw new Error('invalid_external_alert_webhook_config');
 const fields=['endpoint','approvedHostname','bearerToken','timeoutMs'] as const;
 const values=fields.map(key=>{
  const property=Object.getOwnPropertyDescriptor(config,key);
  if(!property||!Object.hasOwn(property,'value'))
   throw new Error('invalid_external_alert_webhook_config');
  return property.value as unknown;
 });
 const [endpoint,approvedHostname,bearerToken,timeoutMs]=values;
 const dedupeField=Object.getOwnPropertyDescriptor(config,'idempotencyWindowMs');
 if(dedupeField&&!Object.hasOwn(dedupeField,'value'))
  throw new Error('invalid_external_alert_webhook_config');
 const idempotencyWindowMs:unknown=dedupeField?.value;
 if(typeof endpoint!=='string'||typeof approvedHostname!=='string'||
    typeof bearerToken!=='string'||typeof timeoutMs!=='number'||
    !Number.isSafeInteger(timeoutMs)||timeoutMs<1000||timeoutMs>30000)
  throw new Error('invalid_external_alert_webhook_config');
 let url:URL;
 try{url=new URL(endpoint);}
 catch{throw new Error('invalid_external_alert_webhook_config');}
 // Exact approved FQDN; do not follow redirects, accept embedded credentials,
 // address literals, port overrides, query strings or URL fragments.
 if(url.protocol!=='https:'||url.port!==''||url.username!==''||
    url.password!==''||url.search!==''||url.hash!==''||
    !/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(approvedHostname)||
    url.hostname!==approvedHostname||isIP(url.hostname)!==0||
    bearerToken.length<16||bearerToken.length>2048||
    !/^[\x21-\x7e]+$/.test(bearerToken)||
    (idempotencyWindowMs!==undefined&&
     (typeof idempotencyWindowMs!=='number'||
      !Number.isSafeInteger(idempotencyWindowMs)||
      idempotencyWindowMs<60000||idempotencyWindowMs>3600000))||
    typeof request!=='function'||typeof clock!=='function')
  throw new Error('invalid_external_alert_webhook_config');
 // Do not capture the mutable user-owned config or allow config getter
 // execution during any subsequent send.
 const destination=url.toString();
 const authorization='Bearer '+bearerToken;
 const timeout=timeoutMs;
 const dedupeWindow=idempotencyWindowMs as number|undefined;
 return Object.freeze({
  async send(alerts:ReadonlyArray<ExternalDeliveryAlert>):Promise<void>{
   if(!Array.isArray(alerts)||alerts.length===0||alerts.length>4)
    throw new Error('invalid_external_alert_webhook_payload');
   const allowedCodes=new Set(['QUEUE_INCONSISTENT','DUE_BACKLOG',
    'EXPIRED_LEASES','TERMINAL_FAILURES']);
   const seen=new Set<string>();
   const safe=alerts.map(alert=>{
    if(!alert||typeof alert!=='object')throw new Error('invalid_external_alert_webhook_payload');
    const properties=['code','severity','observed','threshold'] as const;
    const ownKeys=Reflect.ownKeys(alert);
    if(ownKeys.length!==properties.length||
       ownKeys.some(key=>typeof key!=='string'||!properties.includes(key as typeof properties[number])))
     throw new Error('invalid_external_alert_webhook_payload');
    const values=properties.map(key=>{
     const descriptor=Object.getOwnPropertyDescriptor(alert,key);
     if(!descriptor||!Object.hasOwn(descriptor,'value'))
      throw new Error('invalid_external_alert_webhook_payload');
     return descriptor.value as unknown;
    });
    const [code,severity,observed,threshold]=values;
    if(!allowedCodes.has(code as string)||
       (severity!=='warning'&&severity!=='critical')||
       (code==='QUEUE_INCONSISTENT'?! (severity==='critical'&&threshold===1):
        severity!=='warning')||
       typeof observed!=='number'||!Number.isSafeInteger(observed)||observed<1||
       typeof threshold!=='number'||!Number.isSafeInteger(threshold)||threshold<1||
       observed<threshold||seen.has(code as string))
     throw new Error('invalid_external_alert_webhook_payload');
    seen.add(code as string);
    return {code,severity,observed,threshold};
   });
   const headers:Record<string,string>={
    'content-type':'application/json','authorization':authorization,
   };
   if(dedupeWindow!==undefined){
    const timestamp=clock();
    if(!Number.isSafeInteger(timestamp)||timestamp<0)
     throw new Error('invalid_external_alert_webhook_clock');
    // Canonical order makes the same signals in the same approved time bucket
    // use the same key across workers; the receiver must enforce deduplication.
    const canonical=[...safe].sort((a,b)=>String(a.code).localeCompare(String(b.code)));
    const bucket=Math.floor(timestamp/dedupeWindow);
    const digest=createHash('sha256').update(JSON.stringify({v:1,bucket,alerts:canonical})).digest('hex');
    headers['idempotency-key']='services-alert-v1-'+digest;
   }
   let response:Response;
   try{
    response=await request(destination,{
     method:'POST',
     headers,
     body:JSON.stringify({alerts:safe}),
     redirect:'error',
     signal:AbortSignal.timeout(timeout),
    });
   }catch{
    // Network failures may contain destination URLs or authorization details.
    // Never expose the original message or cause to higher-level logs.
    throw new Error('external_alert_webhook_transport_failed');
   }
   if(!response.ok)throw new Error('external_alert_webhook_delivery_failed');
  },
 } satisfies ExternalDeliveryAlertTransport);
}
