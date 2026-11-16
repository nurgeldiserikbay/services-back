import type {PoolClient} from 'pg';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type PendingClaim={
  intent_id:string;
  channel:string;
  attempt_count:number;
  intent_attempts:number;
  next_attempt_at:Date|null;
  intent_next_attempt_at:Date|null;
};

/**
 * Mark provider acceptance, NOT final delivery to the recipient.
 *
 * Caller owns a PostgreSQL transaction and MUST have received a reliable
 * provider acceptance for this exact intent. The provider integration must
 * use intent_id as an idempotency key and reconcile uncertain timeouts.
 *
 * No response bodies, addresses or provider identifiers are persisted.
 * The current, unexpired fencing token prevents stale worker completion.
 * SENT is terminal to the claim queue: later DELIVERED transitions need a
 * separately authenticated provider callback and their own idempotency gate.
 */
export async function acknowledgeClaimedExternalDeliverySent(
 client:Pick<PoolClient,'query'>,
 deliveryId:string,
 leaseToken:string,
):Promise<Readonly<{intentId:string;attempts:number}>|null>{
 if(!UUID.test(deliveryId)||!UUID.test(leaseToken))
  throw new Error('invalid_external_delivery_claim_proof');

 const selected=await client.query<PendingClaim>(`
  SELECT d.intent_id::text,d.channel,d.attempt_count,
         n.attempts AS intent_attempts,
         d.next_attempt_at,n.next_attempt_at AS intent_next_attempt_at
  FROM notification_deliveries d
  JOIN notification_intents n ON n.id=d.intent_id AND n.channel=d.channel
  WHERE d.id=$1::uuid AND d.lease_token=$2::uuid
    AND d.channel IN ('EMAIL','SMS')
    AND d.state='PENDING' AND n.state='PENDING'
    AND d.lease_expires_at>clock_timestamp()
  FOR UPDATE OF d,n
 `,[deliveryId,leaseToken]);
 if(selected.rows.length===0)return null;
 if(selected.rows.length!==1)throw new Error('invalid_external_delivery_claim');
 const row=selected.rows[0];
 if(!UUID.test(row.intent_id)||
    !Number.isSafeInteger(row.attempt_count)||row.attempt_count<0||
    !Number.isSafeInteger(row.intent_attempts)||
    row.intent_attempts!==row.attempt_count)
  throw new Error('notification_attempt_counter_mismatch');
 // Both schedules must remain identical after the claim. A race or corrupt
 // intent schedule must not be normalized by a successful acknowledgement.
 const due=row.next_attempt_at, intentDue=row.intent_next_attempt_at;
 if((due!==null&&(!(due instanceof Date)||!Number.isFinite(due.getTime())))||
    (intentDue!==null&&
     (!(intentDue instanceof Date)||!Number.isFinite(intentDue.getTime())))||
    (due===null)!==(intentDue===null)||
    (due!==null&&intentDue!==null&&due.getTime()!==intentDue.getTime()))
  throw new Error('notification_retry_schedule_mismatch');
 const attempts=row.attempt_count+1;
 if(!Number.isSafeInteger(attempts))
  throw new RangeError('invalid_delivery_attempt_count');

 const delivery=await client.query<{id:string}>(`
  UPDATE notification_deliveries
  SET state='SENT',attempt_count=$3,next_attempt_at=NULL,
      lease_token=NULL,lease_expires_at=NULL
  WHERE id=$1::uuid AND lease_token=$2::uuid
    AND state='PENDING' AND attempt_count=$4
  RETURNING id::text
 `,[deliveryId,leaseToken,attempts,row.attempt_count]);
 if(delivery.rows.length!==1)throw new Error('external_delivery_claim_lost');
 const intent=await client.query<{id:string}>(`
  UPDATE notification_intents
  SET state='SENT',attempts=$2,next_attempt_at=NULL
  WHERE id=$1::uuid AND channel=$3 AND state='PENDING' AND attempts=$4
  RETURNING id::text
 `,[row.intent_id,attempts,row.channel,row.intent_attempts]);
 if(intent.rows.length!==1)throw new Error('notification_intent_conflict');
 return {intentId:row.intent_id,attempts};
}
