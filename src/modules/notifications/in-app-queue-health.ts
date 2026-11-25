import type {PoolClient} from 'pg';

type QueryClient=Pick<PoolClient,'query'>;
export type InAppQueueHealth=Readonly<{
 pending:number;delivered:number;oldestPendingSeconds:number;
}>;
export type InAppQueueAlert=Readonly<{
 healthy:boolean;pendingOverLimit:boolean;ageOverLimit:boolean;
}>;

/** Aggregate-only read model: no recipient, request, event or contact identifiers.
 * An intent's age comes from its immutable outbox event (intents lack created_at).
 * This function never claims that an external message or a person was notified.
 */
export async function readInAppQueueHealth(client:QueryClient):Promise<InAppQueueHealth>{
 try{
  const result=await client.query<{
   pending:string;delivered:string;oldest_pending_seconds:string|null;
  }>(`
    SELECT
      count(*) FILTER (WHERE n.state='PENDING')::text AS pending,
      count(*) FILTER (WHERE n.state='DELIVERED')::text AS delivered,
      COALESCE(MAX(GREATEST(0,FLOOR(EXTRACT(EPOCH FROM
        (now()-e.created_at))))) FILTER (WHERE n.state='PENDING'),0)::text
        AS oldest_pending_seconds
    FROM notification_intents n
    JOIN domain_outbox_events e ON e.id=n.domain_event_id
    WHERE n.channel='IN_APP'
  `,[]);
  if(result.rows.length!==1)throw Error('invalid_count');
  const row=result.rows[0];
  const read=(raw:string|null):number=>{
   if(typeof raw!=='string'||!/^(?:0|[1-9][0-9]*)$/.test(raw))
    throw Error('invalid_count');
   const count=Number(raw);
   if(!Number.isSafeInteger(count)||count<0)throw Error('invalid_count');
   return count;
  };
  return {
   pending:read(row.pending),delivered:read(row.delivered),
   oldestPendingSeconds:read(row.oldest_pending_seconds),
  };
 }catch{
  // Database or decoding errors may include connection URIs and PII.
  throw new Error('IN_APP queue observation unavailable');
 }
}

/** Pure and bounded thresholds; a nonzero monitor exit permits independent alerting.
 * Equal-to-limit is healthy; strictly exceeding either threshold is not.
 */
export function assessInAppQueueHealth(
 metrics:InAppQueueHealth,maxPending=500,maxAgeSeconds=900,
):InAppQueueAlert{
 if(!Number.isSafeInteger(maxPending)||maxPending<0||maxPending>1000000||
  !Number.isSafeInteger(maxAgeSeconds)||maxAgeSeconds<60||maxAgeSeconds>86400)
  throw new RangeError('invalid_in_app_monitor_threshold');
 for(const key of ['pending','delivered','oldestPendingSeconds'] as const){
  if(!Number.isSafeInteger(metrics[key])||metrics[key]<0)
   throw new RangeError('invalid_in_app_monitor_metric');
 }
 const pendingOverLimit=metrics.pending>maxPending;
 const ageOverLimit=metrics.pending>0&&metrics.oldestPendingSeconds>maxAgeSeconds;
 return {healthy:!pendingOverLimit&&!ageOverLimit,pendingOverLimit,ageOverLimit};
}
