import type {PoolClient} from 'pg';
import {decideExternalAlertReceiverRetry,
 type ReceiverAlertRetryPolicy}
 from './external-delivery-alert-receiver-retry-policy.js';
import {scheduleExternalAlertReceiverRetry}
 from './external-delivery-alert-receiver-retry-schedule.js';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Explicit failure-only routing boundary. Requires the current lease token.
 * Persists either a bounded retry deadline or a count-only terminal record.
 * Do not expose provider exception data, tokens, or raw alert content.
 */
export async function recordExternalAlertReceiverDeliveryFailure(
 db:Pick<PoolClient,'query'>,
 receiverScope:string,
 ingressId:string,
 leaseToken:string,
 policy:ReceiverAlertRetryPolicy,
):Promise<'scheduled'|'terminal'|'stale'>{
 if(!db||typeof db.query!=='function'||
    typeof receiverScope!=='string'||
    !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(receiverScope)||
    typeof ingressId!=='string'||!UUID.test(ingressId)||
    typeof leaseToken!=='string'||!UUID.test(leaseToken))
  throw new Error('invalid_external_alert_receiver_failure');
 // Verify policy before changing persistent state, including when a lease
 // has already gone stale.
 decideExternalAlertReceiverRetry(policy,1);
 const owned=await db.query<{claim_count:string}>(`
  SELECT claim_count::text FROM notification_alert_receiver_ingress
  WHERE id=$1::uuid AND receiver_scope=$2 AND lease_token=$3::uuid
    AND state='PENDING' AND lease_expires_at>clock_timestamp()
 `,[ingressId,receiverScope,leaseToken]);
 if(!Array.isArray(owned.rows)||owned.rows.length>1)
  throw new Error('invalid_external_alert_receiver_database');
 if(owned.rows.length===0)return 'stale';
 const row=owned.rows[0];
 if(!row||typeof row!=='object')
  throw new Error('invalid_external_alert_receiver_database');
 const field=Object.getOwnPropertyDescriptor(row,'claim_count');
 if(!field||!Object.hasOwn(field,'value')||
    typeof field.value!=='string'||
    !/^[1-9][0-9]*$/.test(field.value)||
    BigInt(field.value)>2147483647n)
  throw new Error('invalid_external_alert_receiver_database');
 const decision=decideExternalAlertReceiverRetry(policy,Number(field.value));
 if(decision.retry){
  const result=await scheduleExternalAlertReceiverRetry(
   db,receiverScope,ingressId,leaseToken,decision.delayMs as number);
  return result==='scheduled'?'scheduled':'stale';
 }
 // The token is checked a second time under a row lock before committing
 // terminal state: a worker that lost the lease cannot silence this alert.
 const terminal=await db.query<{ingress_id:string}>(`
  WITH owned AS (
   SELECT id FROM notification_alert_receiver_ingress
   WHERE id=$1::uuid AND receiver_scope=$2 AND lease_token=$3::uuid
     AND state='PENDING' AND lease_expires_at>clock_timestamp()
   FOR UPDATE
  )
  INSERT INTO notification_alert_receiver_terminal_failures(ingress_id)
  SELECT id FROM owned WHERE true
  ON CONFLICT (ingress_id) DO NOTHING
  RETURNING ingress_id::text
 `,[ingressId,receiverScope,leaseToken]);
 if(!Array.isArray(terminal.rows)||terminal.rows.length>1)
  throw new Error('invalid_external_alert_receiver_database');
 return terminal.rows.length===1?'terminal':'stale';
}
