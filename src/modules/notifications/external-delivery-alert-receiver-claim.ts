import type {PoolClient} from 'pg';

export type ReceiverAlertLease=Readonly<{
 id:string;
 token:string;
 alerts:unknown;
}>;

/**
 * Explicit opt-in claim primitive for a trusted worker.
 * Atomic UPDATE with SKIP LOCKED avoids duplicate claims across replicas.
 * A real worker must validate routed alerts and ACK with matching token
 * after downstream acceptance; this helper performs NO network I/O.
 */
export async function claimExternalAlertReceiverIngress(
 db:Pick<PoolClient,'query'>,
 receiverScope:string,
 limit:number,
 leaseMs:number,
):Promise<ReadonlyArray<ReceiverAlertLease>>{
 if(!db||typeof db.query!=='function'||
    typeof receiverScope!=='string'||
    !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(receiverScope)||
    !Number.isSafeInteger(limit)||limit<1||limit>25||
    !Number.isSafeInteger(leaseMs)||leaseMs<5000||leaseMs>300000)
  throw new Error('invalid_external_alert_receiver_lease');
 const result=await db.query<{
  id:string;lease_token:string;alerts:unknown;
 }>(`
  WITH due AS (
   SELECT id FROM notification_alert_receiver_ingress
   WHERE receiver_scope=$1 AND state='PENDING'
     AND claim_count<2147483647
     AND NOT EXISTS (
      SELECT 1 FROM notification_alert_receiver_retry_schedule retry
      WHERE retry.ingress_id=notification_alert_receiver_ingress.id
       AND retry.next_attempt_at>clock_timestamp()
     )
     AND (lease_token IS NULL OR lease_expires_at<=clock_timestamp())
   ORDER BY created_at,id
   FOR UPDATE SKIP LOCKED
   LIMIT $2
  )
  UPDATE notification_alert_receiver_ingress AS ingress
  SET lease_token=gen_random_uuid(),
      lease_expires_at=clock_timestamp()+($3::integer * interval '1 millisecond'),
      claim_count=ingress.claim_count+1
  FROM due WHERE ingress.id=due.id
  RETURNING ingress.id::text,ingress.lease_token::text,ingress.alerts
 `,[receiverScope,limit,leaseMs]);
 if(!Array.isArray(result.rows)||result.rows.length>limit)
  throw new Error('invalid_external_alert_receiver_database');
 return result.rows.map(row=>{
  if(!row||typeof row!=='object')
   throw new Error('invalid_external_alert_receiver_database');
  const values=['id','lease_token','alerts'].map(key=>{
   const field=Object.getOwnPropertyDescriptor(row,key);
   if(!field||!Object.hasOwn(field,'value'))
    throw new Error('invalid_external_alert_receiver_database');
   return field.value as unknown;
  });
  const [id,token,alerts]=values;
  if(typeof id!=='string'||typeof token!=='string'||
     !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)||
     !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(token)||
     !Array.isArray(alerts)||alerts.length<1||alerts.length>4)
   throw new Error('invalid_external_alert_receiver_database');
  return Object.freeze({id,token,alerts});
 });
}
