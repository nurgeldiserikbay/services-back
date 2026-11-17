import type {PoolClient} from 'pg';

/**
 * ACK a receiver ingress item after a separately authorized routing worker
 * has durably recorded downstream delivery acceptance.
 *
 * This is NOT a dispatcher or lease claim. A production worker still needs
 * exclusive claims, retries, deadline control and actual downstream transport.
 * Passing a scope rather than just an ID prevents cross-deployment ACK.
 */
export async function acknowledgeExternalAlertReceiverIngress(
 db:Pick<PoolClient,'query'>,
 receiverScope:string,
 ingressId:string,
):Promise<'acknowledged'|'already_acked'|'not_found'>{
 if(!db||typeof db.query!=='function'||
    typeof receiverScope!=='string'||
    !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(receiverScope)||
    typeof ingressId!=='string'||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(ingressId))
  throw new Error('invalid_external_alert_receiver_ack');
 const changed=await db.query<{id:string}>(`
  UPDATE notification_alert_receiver_ingress
  SET state='ACKED'
  WHERE id=$1::uuid AND receiver_scope=$2 AND state='PENDING'
   AND lease_token IS NULL AND lease_expires_at IS NULL
  RETURNING id
 `,[ingressId,receiverScope]);
 if(!Array.isArray(changed.rows)||changed.rows.length>1)
  throw new Error('invalid_external_alert_receiver_database');
 if(changed.rows.length===1)return 'acknowledged';
 const existing=await db.query<{state:string}>(`
  SELECT state FROM notification_alert_receiver_ingress
  WHERE id=$1::uuid AND receiver_scope=$2
 `,[ingressId,receiverScope]);
 if(!Array.isArray(existing.rows)||existing.rows.length>1)
  throw new Error('invalid_external_alert_receiver_database');
 if(existing.rows.length===0)return 'not_found';
 const row=existing.rows[0];
 if(!row||typeof row!=='object')
  throw new Error('invalid_external_alert_receiver_database');
 const descriptor=Object.getOwnPropertyDescriptor(row,'state');
 if(!descriptor||!Object.hasOwn(descriptor,'value')||
    descriptor.value!=='ACKED')
  throw new Error('invalid_external_alert_receiver_database');
 return 'already_acked';
}

/**
 * Only a worker holding the current, unexpired lease token can ACK a
 * claimed item. Stale workers MUST NOT acknowledge a re-claimed delivery.
 * No transport or scheduling is activated by this helper.
 */
export async function acknowledgeClaimedExternalAlertReceiverIngress(
 db:Pick<PoolClient,'query'>,
 receiverScope:string,
 ingressId:string,
 leaseToken:string,
):Promise<'acknowledged'|'stale'>{
 const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
 if(!db||typeof db.query!=='function'||
    typeof receiverScope!=='string'||
    !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(receiverScope)||
    typeof ingressId!=='string'||!uuid.test(ingressId)||
    typeof leaseToken!=='string'||!uuid.test(leaseToken))
  throw new Error('invalid_external_alert_receiver_ack');
 const changed=await db.query<{id:string}>(`
  UPDATE notification_alert_receiver_ingress
  SET state='ACKED',lease_token=NULL,lease_expires_at=NULL
  WHERE id=$1::uuid AND receiver_scope=$2 AND lease_token=$3::uuid
   AND state='PENDING' AND lease_expires_at>clock_timestamp()
  RETURNING id
 `,[ingressId,receiverScope,leaseToken]);
 if(!Array.isArray(changed.rows)||changed.rows.length>1)
  throw new Error('invalid_external_alert_receiver_database');
 return changed.rows.length===1?'acknowledged':'stale';
}
