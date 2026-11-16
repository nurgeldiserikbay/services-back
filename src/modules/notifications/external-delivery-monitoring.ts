import type {PoolClient} from 'pg';

/**
 * Internal metrics snapshot, not a public endpoint.
 *
 * Counts only; no recipient, payload, phone, email, provider response, token,
 * or idempotency key. A caller must enforce trusted operator authorization
 * before exposing this unscoped aggregate outside an internal process.
 *
 * Keep all decisions against one PostgreSQL timestamp. A pending item with
 * divergent durable retry schedules is counted as inconsistent, never ready.
 */
export type ExternalDeliveryQueueSnapshot=Readonly<{
 pendingDue:number;
 pendingScheduled:number;
 leasedActive:number;
 leasedExpired:number;
 terminalFailed:number;
 providerAccepted:number;
 inconsistent:number;
 total:number;
}>;

const METRICS=['pendingDue','pendingScheduled','leasedActive','leasedExpired',
 'terminalFailed','providerAccepted','inconsistent','total'] as const;

export async function readExternalDeliveryQueueSnapshot(
 client:Pick<PoolClient,'query'>,
):Promise<ExternalDeliveryQueueSnapshot>{
 const result=await client.query<{
  pending_due:string;
  pending_scheduled:string;
  leased_active:string;
  leased_expired:string;
  terminal_failed:string;
  provider_accepted:string;
  inconsistent:string;
  total:string;
 }>(`
  WITH observed AS (
    SELECT d.state AS delivery_state,n.state AS intent_state,
      d.attempt_count,n.attempts,
      d.next_attempt_at AS delivery_due,n.next_attempt_at AS intent_due,
      d.lease_token,d.lease_expires_at,
      statement_timestamp() AS observed_at
    FROM notification_deliveries d
    JOIN notification_intents n ON n.id=d.intent_id AND n.channel=d.channel
    WHERE d.channel IN ('EMAIL','SMS')
  ),
  classified AS (
    SELECT *,
      (
        delivery_state<>intent_state
        OR attempt_count<>attempts
        OR NOT(delivery_due IS NOT DISTINCT FROM intent_due)
        OR (lease_token IS NULL)<>(lease_expires_at IS NULL)
        OR (delivery_state<>'PENDING' AND lease_token IS NOT NULL)
      ) AS inconsistent_row
    FROM observed
  )
  SELECT
    COUNT(*) FILTER(WHERE NOT inconsistent_row
      AND delivery_state='PENDING'
      AND lease_token IS NULL
      AND (delivery_due IS NULL OR delivery_due<=observed_at))::text AS pending_due,
    COUNT(*) FILTER(WHERE NOT inconsistent_row
      AND delivery_state='PENDING'
      AND lease_token IS NULL
      AND delivery_due>observed_at)::text AS pending_scheduled,
    COUNT(*) FILTER(WHERE NOT inconsistent_row
      AND delivery_state='PENDING'
      AND lease_token IS NOT NULL AND lease_expires_at>observed_at)::text AS leased_active,
    COUNT(*) FILTER(WHERE NOT inconsistent_row
      AND delivery_state='PENDING'
      AND lease_token IS NOT NULL AND lease_expires_at<=observed_at)::text AS leased_expired,
    COUNT(*) FILTER(WHERE NOT inconsistent_row
      AND delivery_state='FAILED')::text AS terminal_failed,
    COUNT(*) FILTER(WHERE NOT inconsistent_row
      AND delivery_state IN ('SENT','DELIVERED'))::text AS provider_accepted,
    COUNT(*) FILTER(WHERE inconsistent_row)::text AS inconsistent,
    COUNT(*)::text AS total
  FROM classified
 `,[]);
 if(result.rows.length!==1)
  throw new Error('invalid_notification_monitor_snapshot');
 const raw=result.rows[0] as Record<string,unknown>;
 const keys=['pending_due','pending_scheduled','leased_active','leased_expired',
  'terminal_failed','provider_accepted','inconsistent','total'] as const;
 const values=keys.map(key=>{
  const item=raw[key];
  if(typeof item!=='string'||!/^[0-9]+$/.test(item))
   throw new Error('invalid_notification_monitor_snapshot');
  const parsed=Number(item);
  if(!Number.isSafeInteger(parsed)||parsed<0)
   throw new Error('invalid_notification_monitor_snapshot');
  return parsed;
 });
 const count=values.slice(0,-1).reduce((sum,value)=>sum+value,0);
 if(!Number.isSafeInteger(count)||count!==values[7])
  throw new Error('invalid_notification_monitor_snapshot');
 return Object.fromEntries(METRICS.map((key,index)=>[key,values[index]])) as
  ExternalDeliveryQueueSnapshot;
}
