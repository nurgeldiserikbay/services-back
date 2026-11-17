import type {PoolClient} from 'pg';
import type {ReceiverMonitorBreach}
 from './external-delivery-alert-receiver-monitor-policy.js';

type Db=Pick<PoolClient,'query'>;
const CODES=new Set([
 'RETRY_BACKLOG','EXPIRED_LEASES','TERMINAL_FAILURES','INCONSISTENT_STATE',
]);
const invalid=():never=>{
 throw new Error('invalid_receiver_monitor_delivery_state_input');
};
function validate(scope:string,alerts:readonly ReceiverMonitorBreach[]):void{
 if(typeof scope!=='string'||!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(scope)||
    !Array.isArray(alerts)||alerts.length>4)invalid();
 const seen=new Set<string>();
 for(const item of alerts){
  if(!item||typeof item!=='object'||Array.isArray(item))invalid();
  const names=Reflect.ownKeys(item);
  if(names.length!==3||names.some(name=>typeof name!=='string'||
     !['code','observed','threshold'].includes(name)))invalid();
  const props=['code','observed','threshold'].map(name=>{
   const d=Object.getOwnPropertyDescriptor(item,name);
   if(!d||!Object.hasOwn(d,'value'))return invalid();
   return d.value as unknown;
  });
  const [code,observed,threshold]=props;
  if(typeof code!=='string'||!CODES.has(code)||seen.has(code)||
     typeof observed!=='number'||!Number.isSafeInteger(observed)||
     typeof threshold!=='number'||!Number.isSafeInteger(threshold)||
     threshold<1||observed<threshold)invalid();
  seen.add(code);
 }
}

/**
 * Optional, caller-controlled repeat paging suppression. The caller MUST hold
 * the same-scope PostgreSQL advisory lock from send-lock.ts throughout
 * selection, the HTTPS operation and ACK. This function makes no transport
 * calls and has no default cooldown.
 *
 * Threshold changes immediately re-enable an otherwise suppressed alert.
 */
export async function selectReceiverMonitoringDueBreaches(
 db:Db,
 scope:string,
 breaches:readonly ReceiverMonitorBreach[],
 cooldownSeconds:number,
):Promise<readonly ReceiverMonitorBreach[]>{
 validate(scope,breaches);
 if(!Number.isSafeInteger(cooldownSeconds)||
    cooldownSeconds<60||cooldownSeconds>86400)invalid();
 if(breaches.length===0)return Object.freeze([]);
 const result=await db.query<{
  code:string;due:boolean;last_threshold:string;
 }>(
  `SELECT code,
    (clock_timestamp() >= last_delivered_at +
      $2::integer * interval '1 second') AS due,
    last_threshold::text
   FROM notification_receiver_monitor_delivery_state
   WHERE receiver_scope=$1`,[scope,cooldownSeconds]);
 const state=new Map<string,{due:boolean;threshold:string}>();
 for(const row of result.rows){
  if(typeof row.code!=='string'||!CODES.has(row.code)||
     typeof row.due!=='boolean'||typeof row.last_threshold!=='string'||
     state.has(row.code))throw new Error('invalid_receiver_monitor_delivery_state_snapshot');
  state.set(row.code,{due:row.due,threshold:row.last_threshold});
 }
 return Object.freeze(breaches.filter(breach=>{
  const previous=state.get(breach.code);
  return !previous||previous.due||previous.threshold!==String(breach.threshold);
 }).map(b=>Object.freeze({
  code:b.code,observed:b.observed,threshold:b.threshold,
 })));
}

/**
 * Called ONLY after the HTTPS transport acknowledged all the provided
 * breach records. One atomic upsert persists the scope/code/threshold/time
 * watermark. Provider failure must never invoke this function.
 */
export async function recordReceiverMonitoringDelivered(
 db:Db,scope:string,delivered:readonly ReceiverMonitorBreach[],
):Promise<void>{
 validate(scope,delivered);
 if(delivered.length===0)return;
 const codes=delivered.map(b=>b.code);
 const thresholds=delivered.map(b=>String(b.threshold));
 const result=await db.query(
  `INSERT INTO notification_receiver_monitor_delivery_state
    (receiver_scope,code,last_threshold,last_delivered_at)
   SELECT $1::text, entry.code, entry.threshold, clock_timestamp()
   FROM unnest($2::text[],$3::bigint[]) AS entry(code,threshold)
   ON CONFLICT (receiver_scope,code) DO UPDATE
   SET last_threshold=EXCLUDED.last_threshold,
       last_delivered_at=GREATEST(
        notification_receiver_monitor_delivery_state.last_delivered_at,
        EXCLUDED.last_delivered_at)`,[scope,codes,thresholds]);
 if(result.rowCount!==delivered.length)
  throw new Error('receiver_monitor_delivery_state_update_failed');
}
