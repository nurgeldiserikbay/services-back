import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {recordExternalDeliveryFailure} from './external-delivery-failure.js';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type ExternalDeliveryClaim=Readonly<{
 deliveryId:string;
 intentId:string;
 channel:'EMAIL'|'SMS';
 leaseToken:string;
 leaseExpiresAt:Date;
}>;

/**
 * Claim a due external notification with PostgreSQL row locking.
 * This does NOT send messages. A sender must use the stable intent ID
 * as its provider idempotency key: a lease expiry alone cannot prevent
 * duplicate sends after a provider timeout or lost acknowledgement.
 *
 * Run within DatabasePool.transaction; commit BEFORE provider IO.
 * No destination address, secret, content, or provider response is returned.
 */
export async function claimExternalDelivery(
 client:Pick<PoolClient,'query'>,
 leaseSeconds=90,
):Promise<ExternalDeliveryClaim|null>{
 if(!Number.isSafeInteger(leaseSeconds)||leaseSeconds<30||leaseSeconds>300)
  throw new RangeError('invalid_external_delivery_lease_seconds');
 const token=randomUUID();
 const result=await client.query<{
  id:string;intent_id:string;channel:'EMAIL'|'SMS';lease_expires_at:Date;
 }>(`
  WITH candidate AS (
   SELECT d.id
   FROM notification_deliveries d
   JOIN notification_intents n ON n.id=d.intent_id AND n.channel=d.channel
   WHERE d.channel IN ('EMAIL','SMS')
     AND d.state='PENDING' AND n.state='PENDING'
     AND d.attempt_count=n.attempts
     AND (d.next_attempt_at IS NULL OR d.next_attempt_at<=clock_timestamp())
     AND (d.lease_expires_at IS NULL OR d.lease_expires_at<=clock_timestamp())
   ORDER BY d.next_attempt_at NULLS FIRST,d.id
   LIMIT 1
   FOR UPDATE OF d SKIP LOCKED
  )
  UPDATE notification_deliveries d
  SET lease_token=$1::uuid,
      lease_expires_at=clock_timestamp()+($2::integer * interval '1 second')
  FROM candidate
  WHERE d.id=candidate.id
  RETURNING d.id::text,d.intent_id::text,d.channel,d.lease_expires_at
 `,[token,leaseSeconds]);
 if(result.rows.length===0)return null;
 if(result.rows.length!==1)throw new Error('invalid_external_delivery_claim');
 const r=result.rows[0];
 if(!UUID.test(r.id)||!UUID.test(r.intent_id)||
    !['EMAIL','SMS'].includes(r.channel)||
    !(r.lease_expires_at instanceof Date)||!Number.isFinite(r.lease_expires_at.getTime()))
  throw new Error('invalid_external_delivery_claim');
 return {deliveryId:r.id,intentId:r.intent_id,channel:r.channel,
  leaseToken:token,leaseExpiresAt:r.lease_expires_at};
}

/**
 * Acknowledge provider failure only while holding the CURRENT unexpired lease.
 * Both delivery and intent updates happen in the caller's transaction.
 * A stale worker cannot increment retries or overwrite another claim.
 */
export async function failClaimedExternalDelivery(
 client:Pick<PoolClient,'query'>,
 deliveryId:string,
 leaseToken:string,
 now:Date,
 maxAttempts=5,
):Promise<Awaited<ReturnType<typeof recordExternalDeliveryFailure>>|null>{
 if(!UUID.test(deliveryId)||!UUID.test(leaseToken))
  throw new Error('invalid_external_delivery_claim_proof');
 if(!(now instanceof Date)||!Number.isFinite(now.getTime()))
  throw new RangeError('invalid_delivery_retry_time');
 if(!Number.isSafeInteger(maxAttempts)||maxAttempts<1||maxAttempts>20)
  throw new RangeError('invalid_delivery_max_attempts');

 const locked=await client.query<{id:string}>(`
  SELECT id::text FROM notification_deliveries
  WHERE id=$1::uuid AND lease_token=$2::uuid
    AND channel IN ('EMAIL','SMS') AND state='PENDING'
    AND lease_expires_at>clock_timestamp()
  FOR UPDATE
 `,[deliveryId,leaseToken]);
 if(locked.rows.length===0)return null;
 if(locked.rows.length!==1)throw new Error('invalid_external_delivery_claim');
 const result=await recordExternalDeliveryFailure(client,deliveryId,now,maxAttempts);
 if(!result)throw new Error('external_delivery_claim_lost');
 const released=await client.query<{id:string}>(`
  UPDATE notification_deliveries
  SET lease_token=NULL,lease_expires_at=NULL
  WHERE id=$1::uuid AND lease_token=$2::uuid
  RETURNING id::text
 `,[deliveryId,leaseToken]);
 if(released.rows.length!==1)throw new Error('external_delivery_claim_lost');
 return result;
}
