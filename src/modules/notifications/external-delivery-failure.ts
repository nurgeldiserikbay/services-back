import type {PoolClient} from 'pg';
import {planNotificationRetry} from './delivery-retry-policy.js';

type DeliveryRow={
 id:string;
 intent_id:string;
 channel:string;
 state:string;
 attempt_count:number;
 intent_attempts:number;
 next_attempt_at:Date|null;
 intent_state:string;
};

/**
 * Persist an external provider failure in the caller's existing transaction.
 * The caller must hold exclusive ownership of the attempt while sending:
 * this function is NOT a provider sender or an attempt-leasing mechanism.
 *
 * No provider error, address, token, response body, or message content is stored.
 * Concurrent failure recorders serialize on the delivery row; only a PENDING
 * delivery/intent can advance and a terminal failure is never retried here.
 */
export async function recordExternalDeliveryFailure(
 client:Pick<PoolClient,'query'>,
 deliveryId:string,
 now:Date,
 maxAttempts=5,
):Promise<Readonly<{state:'PENDING'|'FAILED';attempts:number;nextAttemptAt:Date|null}>|null>{
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(deliveryId))
  throw new Error('invalid_notification_delivery_id');
 if(!(now instanceof Date)||!Number.isFinite(now.getTime()))
  throw new RangeError('invalid_delivery_retry_time');
 if(!Number.isSafeInteger(maxAttempts)||maxAttempts<1||maxAttempts>20)
  throw new RangeError('invalid_delivery_max_attempts');

 const selected=await client.query<DeliveryRow>(`
  SELECT d.id::text,d.intent_id::text,d.channel,d.state,d.attempt_count,d.next_attempt_at,
         n.state AS intent_state,n.attempts AS intent_attempts
  FROM notification_deliveries d
  JOIN notification_intents n ON n.id=d.intent_id AND n.channel=d.channel
  WHERE d.id=$1::uuid AND d.channel IN ('EMAIL','SMS')
  FOR UPDATE OF d,n
 `,[deliveryId]);
 if(selected.rows.length!==1)return null;
 const row=selected.rows[0];
 if(row.state!=='PENDING'||row.intent_state!=='PENDING')return null;
 // A scheduled retry must never be consumed before its due timestamp.
 if(row.next_attempt_at!==null){
  if(!(row.next_attempt_at instanceof Date)||!Number.isFinite(row.next_attempt_at.getTime()))
   throw new Error('invalid_delivery_next_attempt_time');
  if(row.next_attempt_at.getTime()>now.getTime())return null;
 }
 if(!Number.isSafeInteger(row.attempt_count)||row.attempt_count<0)
  throw new Error('invalid_delivery_attempt_count');
 // The two durable counters must represent the same attempt. Never silently
 // repair contradictory database state by overwriting either counter.
 if(!Number.isSafeInteger(row.intent_attempts)||row.intent_attempts!==row.attempt_count)
  throw new Error('notification_attempt_counter_mismatch');
 const attempts=row.attempt_count+1;
 const decision=planNotificationRetry(attempts,now,maxAttempts);
 const nextAttemptAt=decision.nextAttemptAt;
 const updated=await client.query<{id:string}>(`
  UPDATE notification_deliveries
  SET state=$2,attempt_count=$3,next_attempt_at=$4
  WHERE id=$1::uuid AND state='PENDING' AND attempt_count=$5
  RETURNING id::text
 `,[deliveryId,decision.state,attempts,nextAttemptAt,row.attempt_count]);
 if(updated.rows.length!==1)
  throw new Error('notification_delivery_conflict');
 const intent=await client.query<{id:string}>(`
  UPDATE notification_intents
  SET state=$2,attempts=$3,next_attempt_at=$4
  WHERE id=$1::uuid AND channel=$5 AND state='PENDING'
  RETURNING id::text
 `,[row.intent_id,decision.state,attempts,nextAttemptAt,row.channel]);
 if(intent.rows.length!==1)
  throw new Error('notification_intent_conflict');
 return {state:decision.state,attempts,nextAttemptAt};
}
