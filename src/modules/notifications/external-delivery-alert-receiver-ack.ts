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
