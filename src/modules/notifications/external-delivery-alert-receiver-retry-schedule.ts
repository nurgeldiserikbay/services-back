import type {PoolClient} from 'pg';

/**
 * Persist a bounded retry deadline only while holding the CURRENT unexpired
 * receiver lease. This does not release, ACK, or contact any provider.
 * The claim query skips ingress rows until the persisted deadline.
 * Call after a failed delivery attempt with autocommitted SQL.
 */
export async function scheduleExternalAlertReceiverRetry(
 db:Pick<PoolClient,'query'>,
 receiverScope:string,
 ingressId:string,
 leaseToken:string,
 delayMs:number,
):Promise<'scheduled'|'stale'>{
 const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
 if(!db||typeof db.query!=='function'||
    typeof receiverScope!=='string'||
    !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(receiverScope)||
    typeof ingressId!=='string'||!uuid.test(ingressId)||
    typeof leaseToken!=='string'||!uuid.test(leaseToken)||
    !Number.isSafeInteger(delayMs)||delayMs<1000||delayMs>3600000)
  throw new Error('invalid_external_alert_receiver_retry_schedule');
 const result=await db.query<{ingress_id:string}>(`
  WITH owned AS (
   SELECT id FROM notification_alert_receiver_ingress
   WHERE id=$1::uuid AND receiver_scope=$2
     AND lease_token=$3::uuid AND state='PENDING'
     AND lease_expires_at>clock_timestamp()
   FOR UPDATE
  )
  INSERT INTO notification_alert_receiver_retry_schedule
   (ingress_id,next_attempt_at,updated_at)
  SELECT id,clock_timestamp()+($4::integer*interval '1 millisecond'),
         clock_timestamp()
  FROM owned
  ON CONFLICT (ingress_id) DO UPDATE
  SET next_attempt_at=EXCLUDED.next_attempt_at,
      updated_at=EXCLUDED.updated_at
  RETURNING ingress_id::text
 `,[ingressId,receiverScope,leaseToken,delayMs]);
 if(!Array.isArray(result.rows)||result.rows.length>1)
  throw new Error('invalid_external_alert_receiver_database');
 return result.rows.length===1?'scheduled':'stale';
}
