import type {PoolClient} from 'pg';
import {randomUUID} from 'node:crypto';
import type {ExternalDeliveryAlert} from './external-delivery-alerts.js';

export type ClaimedExternalAlert=Readonly<{
 eventId:string;
 code:ExternalDeliveryAlert['code'];
 generation:string;
 observed:string;
 threshold:string;
 severity:ExternalDeliveryAlert['severity'];
 leaseToken:string;
}>;

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CODES=new Set(['QUEUE_INCONSISTENT','DUE_BACKLOG',
 'EXPIRED_LEASES','TERMINAL_FAILURES']);
const DECIMAL=/^(0|[1-9][0-9]*)$/;
function ownData(value:unknown,key:string):unknown{
 if(!value||typeof value!=='object')return undefined;
 const descriptor=Object.getOwnPropertyDescriptor(value,key);
 return descriptor&&Object.hasOwn(descriptor,'value')?descriptor.value:undefined;
}
function checkedRows(result:unknown):unknown[]{
 const rows=ownData(result,'rows');
 if(!Array.isArray(rows))throw new Error('invalid_external_alert_dispatch_result');
 return rows;
}

/**
 * CALL WITHIN a PostgreSQL transaction. Commit before external I/O.
 * Row locks + SKIP LOCKED fence competing workers. Expired claims can be
 * retried: a real provider MUST support a stable idempotency key of
 * (code,generation), because a crash after send and before ACK can replay.
 */
export async function claimExternalAlertEvent(
 client:Pick<PoolClient,'query'>,
 leaseSeconds:number,
):Promise<ClaimedExternalAlert|null>{
 if(!client||typeof client.query!=='function'||
    !Number.isSafeInteger(leaseSeconds)||leaseSeconds<30||
    leaseSeconds>300)
  throw new Error('invalid_external_alert_dispatch_claim');
 // Add at most 100 missing dispatch rows per invocation. Events never mutate.
 await client.query(`
  INSERT INTO notification_alert_dispatches(event_id)
  SELECT e.id FROM notification_alert_events e
  WHERE NOT EXISTS (
   SELECT 1 FROM notification_alert_dispatches d WHERE d.event_id=e.id
  )
  ORDER BY e.created_at,e.id LIMIT 100
  ON CONFLICT (event_id) DO NOTHING
 `,[]);
 const leaseToken=randomUUID();
 const result=await client.query<{
  event_id:string;code:string;generation:string;
  observed:string;threshold:string;severity:string;
 }>(`
  WITH selected AS (
   SELECT d.event_id
   FROM notification_alert_dispatches d
   JOIN notification_alert_events e ON e.id=d.event_id
   WHERE d.delivered_at IS NULL
     AND (d.lease_expires_at IS NULL OR
       d.lease_expires_at<=clock_timestamp())
   ORDER BY e.created_at,e.id
   LIMIT 1 FOR UPDATE OF d SKIP LOCKED
  ), claimed AS (
   UPDATE notification_alert_dispatches d
   SET lease_token=$1::uuid,
       lease_expires_at=clock_timestamp()+($2::integer*interval '1 second'),
       attempt_count=attempt_count+1
   FROM selected s WHERE d.event_id=s.event_id
   RETURNING d.event_id
  )
  SELECT e.id AS event_id,e.code,e.generation::text,
   e.observed::text,e.threshold::text,e.severity
  FROM claimed c JOIN notification_alert_events e ON e.id=c.event_id
 `,[leaseToken,leaseSeconds]);
 const rows=checkedRows(result);
 if(rows.length===0)return null;
 if(rows.length!==1)
  throw new Error('invalid_external_alert_dispatch_row');
 const candidate=rows[0];
 const row={
  event_id:ownData(candidate,'event_id'),
  code:ownData(candidate,'code'),
  generation:ownData(candidate,'generation'),
  observed:ownData(candidate,'observed'),
  threshold:ownData(candidate,'threshold'),
  severity:ownData(candidate,'severity'),
 };
 if(typeof row.event_id!=='string'||!UUID.test(row.event_id)||
    typeof row.code!=='string'||!CODES.has(row.code)||
    typeof row.generation!=='string'||!DECIMAL.test(row.generation)||
    BigInt(row.generation)<1n||
    typeof row.observed!=='string'||!DECIMAL.test(row.observed)||
    typeof row.threshold!=='string'||!DECIMAL.test(row.threshold)||
    BigInt(row.threshold)<1n||
    (row.severity!=='critical'&&row.severity!=='warning'))
  throw new Error('invalid_external_alert_dispatch_row');
 return {
  eventId:row.event_id,code:row.code as ClaimedExternalAlert['code'],
  generation:row.generation,observed:row.observed,
  threshold:row.threshold,severity:row.severity as ClaimedExternalAlert['severity'],
  leaseToken,
 };
}

/**
 * Commit this ACK in its own transaction after the external publisher
 * durably acknowledges the stable episode key. A stale or expired lease
 * cannot acknowledge someone else's work.
 */
export async function acknowledgeExternalAlertEvent(
 client:Pick<PoolClient,'query'>,
 eventId:string,
 leaseToken:string,
):Promise<boolean>{
 if(!client||typeof client.query!=='function'||
    typeof eventId!=='string'||!UUID.test(eventId)||
    typeof leaseToken!=='string'||!UUID.test(leaseToken))
  throw new Error('invalid_external_alert_dispatch_ack');
 const result=await client.query<{event_id:string}>(`
  UPDATE notification_alert_dispatches
  SET delivered_at=clock_timestamp(),lease_token=NULL,lease_expires_at=NULL
  WHERE event_id=$1::uuid AND lease_token=$2::uuid
    AND delivered_at IS NULL
    AND lease_expires_at>clock_timestamp()
  RETURNING event_id
 `,[eventId,leaseToken]);
 const rows=checkedRows(result);
 if(rows.length>1||
    (rows.length===1&&
     (typeof ownData(rows[0],'event_id')!=='string'||
      String(ownData(rows[0],'event_id')).toLowerCase()!==eventId.toLowerCase())))
  throw new Error('invalid_external_alert_dispatch_ack_result');
 return rows.length===1;
}
