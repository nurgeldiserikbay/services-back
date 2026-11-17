import type {PoolClient} from 'pg';
import type {ExternalDeliveryAlert} from './external-delivery-alerts.js';
import type {ExternalDeliveryAlertTransport}
 from './external-delivery-alert-dispatch.js';
import {claimExternalAlertReceiverIngress}
 from './external-delivery-alert-receiver-claim.js';
import {acknowledgeClaimedExternalAlertReceiverIngress}
 from './external-delivery-alert-receiver-ack.js';

const CODES=new Set(['QUEUE_INCONSISTENT','DUE_BACKLOG',
 'EXPIRED_LEASES','TERMINAL_FAILURES']);

/**
 * Opt-in, single-item receiver routing cycle. The caller must supply an
 * operator-approved transport and use autocommitted database statements:
 * never hold a PostgreSQL transaction open across external network I/O.
 * Lease TTL must exceed the transport deadline plus ACK margin.
 *
 * If send fails the lease remains pending and can be reclaimed at expiry;
 * no ACK occurs. Not registered with any HTTP route or scheduler.
 */
export async function deliverOneExternalAlertReceiverIngress(
 db:Pick<PoolClient,'query'>,
 receiverScope:string,
 leaseMs:number,
 transport:ExternalDeliveryAlertTransport,
):Promise<'empty'|'acknowledged'|'stale'>{
 if(!transport||typeof transport!=='object')
  throw new Error('invalid_external_alert_receiver_transport');
 const sender=Object.getOwnPropertyDescriptor(transport,'send');
 if(!sender||!Object.hasOwn(sender,'value')||
    typeof sender.value!=='function')
  throw new Error('invalid_external_alert_receiver_transport');
 const claims=await claimExternalAlertReceiverIngress(
  db,receiverScope,1,leaseMs);
 if(claims.length===0)return 'empty';
 const item=claims[0];
 // Check every read field from the durable JSONB row; do not allow a driver
 // accessor/extra field to carry PII to the downstream transport.
 if(!Array.isArray(item.alerts)||item.alerts.length<1||item.alerts.length>4)
  throw new Error('invalid_external_alert_receiver_payload');
 const seen=new Set<string>();
 const safe=item.alerts.map(raw=>{
  if(!raw||typeof raw!=='object'||Array.isArray(raw))
   throw new Error('invalid_external_alert_receiver_payload');
  const fields=['code','severity','observed','threshold'] as const;
  const keys=Reflect.ownKeys(raw);
  if(keys.length!==fields.length||
     keys.some(key=>typeof key!=='string'||
      !fields.includes(key as typeof fields[number])))
   throw new Error('invalid_external_alert_receiver_payload');
  const vals=fields.map(field=>{
   const property=Object.getOwnPropertyDescriptor(raw,field);
   if(!property||!Object.hasOwn(property,'value'))
    throw new Error('invalid_external_alert_receiver_payload');
   return property.value as unknown;
  });
  const [code,severity,observed,threshold]=vals;
  if(typeof code!=='string'||!CODES.has(code)||seen.has(code)||
     (code==='QUEUE_INCONSISTENT'?
      severity!=='critical'||threshold!==1:severity!=='warning')||
     typeof observed!=='number'||!Number.isSafeInteger(observed)||
     typeof threshold!=='number'||!Number.isSafeInteger(threshold)||
     threshold<1||observed<threshold)
   throw new Error('invalid_external_alert_receiver_payload');
  seen.add(code);
  return Object.freeze({code,severity,observed,threshold}) as ExternalDeliveryAlert;
 });
 // An external send may be accepted just before this lease expires. A stale
 // ACK is reported, never silently treated as successful confirmation.
 await (sender.value as ExternalDeliveryAlertTransport['send'])
  .call(transport,Object.freeze(safe));
 return acknowledgeClaimedExternalAlertReceiverIngress(
  db,receiverScope,item.id,item.token);
}
