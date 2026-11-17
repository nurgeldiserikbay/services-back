import type {PoolClient} from 'pg';
import {readExternalDeliveryQueueSnapshot}
 from './external-delivery-monitoring.js';
import {evaluateExternalDeliveryQueueAlerts,
 type ExternalDeliveryAlertPolicy,type ExternalDeliveryAlert}
 from './external-delivery-alerts.js';

const CODES=[
 'DUE_BACKLOG','EXPIRED_LEASES','QUEUE_INCONSISTENT','TERMINAL_FAILURES',
] as const;

/**
 * Transactional, count-only alert episode staging. CALL INSIDE A
 * PostgreSQL transaction and commit before any external provider I/O.
 * Locks the four state rows before reading queue metrics so competing
 * staging transactions serialize their episode decisions.
 *
 * No transport or scheduler is activated. Outbox consumers must use
 * (code,generation) as a stable provider idempotency key and implement
 * separate delivery ACK/retry. Any SQL/COMMIT failure must propagate.
 */
export async function stageExternalDeliveryAlertEpisodes(
 client:Pick<PoolClient,'query'>,
 policy:ExternalDeliveryAlertPolicy,
):Promise<Readonly<{created:number;recovered:number}>>{
 if(!client||typeof client.query!=='function')
  throw new Error('invalid_external_alert_episode_database');
 // Initialize stable state identities before acquiring row locks. ON CONFLICT
 // blocks concurrent initialization and ensures one row per alert code.
 await client.query(`
  INSERT INTO notification_alert_states(code)
  SELECT unnest($1::text[])
  ON CONFLICT (code) DO NOTHING
 `,[CODES]);
 const locked=await client.query<{
  code:string;active:boolean;generation:string;
 }>(`
  SELECT code,active,generation::text
  FROM notification_alert_states
  WHERE code=ANY($1::text[]) ORDER BY code FOR UPDATE
 `,[CODES]);
 // Never execute driver/host-provided getters or trust inherited fields.
 // Validate every row before reading the monitoring snapshot or updating state.
 if(!Array.isArray(locked.rows)||locked.rows.length!==CODES.length)
  throw new Error('invalid_external_alert_episode_state');
 const states=locked.rows.map((row,index)=>{
  if(!row||typeof row!=='object')
   throw new Error('invalid_external_alert_episode_state');
  const values=['code','active','generation'].map(key=>{
   const field=Object.getOwnPropertyDescriptor(row,key);
   if(!field||!Object.hasOwn(field,'value'))
    throw new Error('invalid_external_alert_episode_state');
   return field.value as unknown;
  });
  const [code,active,generation]=values;
  if(code!==CODES[index]||typeof active!=='boolean'||
     typeof generation!=='string'||!/^(0|[1-9][0-9]*)$/.test(generation)||
     BigInt(generation)>9223372036854775807n)
   throw new Error('invalid_external_alert_episode_state');
  return {code:CODES[index],active,generation};
 });
 const snapshot=await readExternalDeliveryQueueSnapshot(client);
 const activeAlerts=evaluateExternalDeliveryQueueAlerts(snapshot,policy);
 const alerts=new Map<ExternalDeliveryAlert['code'],ExternalDeliveryAlert>(
  activeAlerts.map(alert=>[alert.code,alert]));
 let created=0,recovered=0;
 for(const state of states){
  const alert=alerts.get(state.code as ExternalDeliveryAlert['code']);
  if(alert&&!state.active){
   const next=BigInt(state.generation)+1n;
   if(next>9223372036854775807n)
    throw new Error('external_alert_episode_generation_exhausted');
   await client.query(`
    UPDATE notification_alert_states
    SET active=true,generation=$2::bigint,updated_at=clock_timestamp()
    WHERE code=$1
   `,[state.code,next.toString()]);
   await client.query(`
    INSERT INTO notification_alert_events
     (code,generation,observed,threshold,severity)
    VALUES($1,$2::bigint,$3::bigint,$4::bigint,$5)
   `,[state.code,next.toString(),alert.observed,alert.threshold,alert.severity]);
   created++;
  }else if(!alert&&state.active){
   await client.query(`
    UPDATE notification_alert_states
    SET active=false,updated_at=clock_timestamp()
    WHERE code=$1
   `,[state.code]);
   recovered++;
  }
 }
 return {created,recovered};
}
