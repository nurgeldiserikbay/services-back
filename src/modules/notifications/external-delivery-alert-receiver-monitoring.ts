import type {PoolClient} from 'pg';

/** Private operator-only receiver ingress inventory; no identities or payloads. */
export type ReceiverIngressCounts=Readonly<{
 ready:number;
 retryScheduled:number;
 leasedActive:number;
 leasedExpired:number;
 terminal:number;
 acknowledged:number;
 inconsistent:number;
 total:number;
}>;

/**
 * Always scoped to an approved deployment. Never expose directly to guests
 * or public routes. Uses one SQL statement snapshot with disjoint buckets.
 */
export async function readExternalAlertReceiverCounts(
 db:Pick<PoolClient,'query'>,
 receiverScope:string,
):Promise<ReceiverIngressCounts>{
 if(!db||typeof db.query!=='function'||
    typeof receiverScope!=='string'||
    !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(receiverScope))
  throw new Error('invalid_external_alert_receiver_monitor_input');
 const result=await db.query<Record<string,string>>(`
  WITH classified AS (
   SELECT CASE
    WHEN i.state='ACKED' THEN 'acknowledged'
    WHEN i.state<>'PENDING' THEN 'inconsistent'
    WHEN t.ingress_id IS NOT NULL THEN 'terminal'
    WHEN r.next_attempt_at>statement_timestamp() THEN 'retry_scheduled'
    WHEN i.lease_token IS NULL AND i.lease_expires_at IS NULL THEN 'ready'
    WHEN i.lease_token IS NOT NULL AND
         i.lease_expires_at>statement_timestamp() THEN 'leased_active'
    WHEN i.lease_token IS NOT NULL AND
         i.lease_expires_at<=statement_timestamp() THEN 'leased_expired'
    ELSE 'inconsistent' END AS bucket
   FROM notification_alert_receiver_ingress i
   LEFT JOIN notification_alert_receiver_retry_schedule r
     ON r.ingress_id=i.id
   LEFT JOIN notification_alert_receiver_terminal_failures t
     ON t.ingress_id=i.id
   WHERE i.receiver_scope=$1
  )
  SELECT
   COUNT(*) FILTER (WHERE bucket='ready')::text AS ready,
   COUNT(*) FILTER (WHERE bucket='retry_scheduled')::text AS retry_scheduled,
   COUNT(*) FILTER (WHERE bucket='leased_active')::text AS leased_active,
   COUNT(*) FILTER (WHERE bucket='leased_expired')::text AS leased_expired,
   COUNT(*) FILTER (WHERE bucket='terminal')::text AS terminal,
   COUNT(*) FILTER (WHERE bucket='acknowledged')::text AS acknowledged,
   COUNT(*) FILTER (WHERE bucket='inconsistent')::text AS inconsistent,
   COUNT(*)::text AS total
  FROM classified
 `,[receiverScope]);
 if(!Array.isArray(result.rows)||result.rows.length!==1||
    !result.rows[0]||typeof result.rows[0]!=='object')
  throw new Error('invalid_external_alert_receiver_monitor_snapshot');
 const row=result.rows[0];
 const fields=['ready','retry_scheduled','leased_active','leased_expired',
  'terminal','acknowledged','inconsistent','total'] as const;
 const values=fields.map(key=>{
  const descriptor=Object.getOwnPropertyDescriptor(row,key);
  if(!descriptor||!Object.hasOwn(descriptor,'value')||
     typeof descriptor.value!=='string'||
     !/^(0|[1-9][0-9]*)$/.test(descriptor.value))
   throw new Error('invalid_external_alert_receiver_monitor_snapshot');
  const value=Number(descriptor.value);
  if(!Number.isSafeInteger(value)||value<0)
   throw new Error('invalid_external_alert_receiver_monitor_snapshot');
  return value;
 });
 if(values.slice(0,7).reduce((a,b)=>a+b,0)!==values[7])
  throw new Error('invalid_external_alert_receiver_monitor_snapshot');
 const [ready,retryScheduled,leasedActive,leasedExpired,
  terminal,acknowledged,inconsistent,total]=values;
 return Object.freeze({ready,retryScheduled,leasedActive,leasedExpired,
  terminal,acknowledged,inconsistent,total});
}
