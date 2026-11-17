import {createHash} from 'node:crypto';
import type {PoolClient} from 'pg';
import type {ExternalDeliveryAlert} from './external-delivery-alerts.js';

const CODES=new Set(['QUEUE_INCONSISTENT','DUE_BACKLOG',
 'EXPIRED_LEASES','TERMINAL_FAILURES']);

/**
 * Invoke only AFTER a separate HTTP boundary has authenticated the receiver
 * sender and derived receiverScope from a trusted server-side identity.
 * One unique PostgreSQL INSERT durably accepts and queues the alert at once.
 * The receiver must route PENDING rows and ACK them separately.
 */
export async function acceptExternalDeliveryAlertIngress(
 db:Pick<PoolClient,'query'>,
 receiverScope:string,
 key:string,
 alerts:ReadonlyArray<ExternalDeliveryAlert>,
):Promise<'accepted'|'duplicate'>{
 if(!db||typeof db.query!=='function'||
    typeof receiverScope!=='string'||
    !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(receiverScope)||
    typeof key!=='string'||!/^services-alert-v2-[a-f0-9]{64}$/.test(key)||
    !Array.isArray(alerts)||alerts.length<1||alerts.length>4)
  throw new Error('invalid_external_alert_receiver_input');
 const seen=new Set<string>();
 const normalized=alerts.map(alert=>{
  if(!alert||typeof alert!=='object')
   throw new Error('invalid_external_alert_receiver_input');
  const fields=['code','severity','observed','threshold'] as const;
  const keys=Reflect.ownKeys(alert);
  if(keys.length!==fields.length||
     keys.some(field=>typeof field!=='string'||
      !fields.includes(field as typeof fields[number])))
   throw new Error('invalid_external_alert_receiver_input');
  const values=fields.map(field=>{
   const descriptor=Object.getOwnPropertyDescriptor(alert,field);
   if(!descriptor||!Object.hasOwn(descriptor,'value'))
    throw new Error('invalid_external_alert_receiver_input');
   return descriptor.value as unknown;
  });
  const [code,severity,observed,threshold]=values;
  if(typeof code!=='string'||!CODES.has(code)||seen.has(code)||
     (code==='QUEUE_INCONSISTENT'?
      (severity!=='critical'||threshold!==1):severity!=='warning')||
     typeof observed!=='number'||!Number.isSafeInteger(observed)||
     typeof threshold!=='number'||!Number.isSafeInteger(threshold)||
     threshold<1||observed<threshold)
   throw new Error('invalid_external_alert_receiver_input');
  seen.add(code);
  return {code,severity,observed,threshold};
 }).sort((a,b)=>a.code.localeCompare(b.code));
 const body=JSON.stringify(normalized);
 const digest=createHash('sha256').update(body).digest('hex');
 // Only one replica can insert a (scope,key); the same row is the durable
 // outbox, so a crash cannot ACK a notification that was never persisted.
 const result=await db.query<{id:string}>(`
  INSERT INTO notification_alert_receiver_ingress
   (receiver_scope,idempotency_key,body_digest,alerts)
  VALUES($1,$2,$3,$4::jsonb)
  ON CONFLICT (receiver_scope,idempotency_key) DO NOTHING
  RETURNING id
 `,[receiverScope,key,digest,body]);
 if(!Array.isArray(result.rows)||result.rows.length>1)
  throw new Error('invalid_external_alert_receiver_database');
 if(result.rows.length===1)return 'accepted';
 // A separate statement under READ COMMITTED sees a concurrently committed
 // winner after the ON CONFLICT operation has waited on the uniqueness lock.
 const prior=await db.query<{body_digest:string}>(`
  SELECT body_digest
  FROM notification_alert_receiver_ingress
  WHERE receiver_scope=$1 AND idempotency_key=$2
 `,[receiverScope,key]);
 if(!Array.isArray(prior.rows)||prior.rows.length!==1)
  throw new Error('invalid_external_alert_receiver_database');
 const existing=prior.rows[0];
 if(!existing||typeof existing!=='object')
  throw new Error('invalid_external_alert_receiver_database');
 const property=Object.getOwnPropertyDescriptor(existing,'body_digest');
 if(!property||!Object.hasOwn(property,'value')||
    typeof property.value!=='string')
  throw new Error('invalid_external_alert_receiver_database');
 if(property.value!==digest)
  throw new Error('external_alert_receiver_idempotency_conflict');
 return 'duplicate';
}
