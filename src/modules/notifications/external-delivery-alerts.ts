import type {ExternalDeliveryQueueSnapshot} from './external-delivery-monitoring.js';

/**
 * Evaluation only. There is intentionally no default threshold, alert transport,
 * scheduler, or HTTP endpoint. Production alert thresholds must be approved
 * against real traffic and a measured baseline before enabling this evaluator.
 */
export type ExternalDeliveryAlertPolicy=Readonly<{
 pendingDueThreshold:number;
 expiredLeaseThreshold:number;
 terminalFailedThreshold:number;
}>;

export type ExternalDeliveryAlert=Readonly<{
 code:'QUEUE_INCONSISTENT'|'DUE_BACKLOG'|'EXPIRED_LEASES'|'TERMINAL_FAILURES';
 severity:'critical'|'warning';
 observed:number;
 threshold:number;
}>;

const COUNTS=['pendingDue','pendingScheduled','leasedActive','leasedExpired',
 'terminalFailed','providerAccepted','inconsistent','total'] as const;


/**
 * Monitoring is an internal boundary but may receive parsed or host-supplied
 * objects. Read own DATA properties only: inherited fields and getter-backed
 * values must not be trusted or executed during an alert evaluation.
 */
function ownDataValue(source:object,key:string):unknown{
 const descriptor=Object.getOwnPropertyDescriptor(source,key);
 if(!descriptor||!Object.hasOwn(descriptor,'value'))
  throw new Error('invalid_external_delivery_alert_input');
 return descriptor.value;
}

/** Return safe aggregate signals only; never include addresses, request IDs,
 * provider responses, tokens, or contacts in an alert payload.
 * Invalid/partial telemetry fails closed instead of producing false "healthy".
 */
export function evaluateExternalDeliveryQueueAlerts(
 snapshot:ExternalDeliveryQueueSnapshot,
 policy:ExternalDeliveryAlertPolicy,
):ReadonlyArray<ExternalDeliveryAlert>{
 if(!snapshot||typeof snapshot!=='object'||
    !policy||typeof policy!=='object')
  throw new Error('invalid_external_delivery_alert_input');
 for(const key of COUNTS){
  const count=ownDataValue(snapshot,key);
  if(!Number.isSafeInteger(count)||count<0)
   throw new Error('invalid_external_delivery_alert_snapshot');
 }
 const total=COUNTS.slice(0,-1).reduce((sum,key)=>sum+Number(ownDataValue(snapshot,key)),0);
 if(!Number.isSafeInteger(total)||total!==ownDataValue(snapshot,'total'))
  throw new Error('invalid_external_delivery_alert_snapshot');
 const pendingDueThreshold=ownDataValue(policy,'pendingDueThreshold');
 const expiredLeaseThreshold=ownDataValue(policy,'expiredLeaseThreshold');
 const terminalFailedThreshold=ownDataValue(policy,'terminalFailedThreshold');
 for(const threshold of [pendingDueThreshold,expiredLeaseThreshold,
  terminalFailedThreshold]){
  if(!Number.isSafeInteger(threshold)||threshold<1)
   throw new Error('invalid_external_delivery_alert_policy');
 }
 const counts=Object.fromEntries(COUNTS.map(key=>[key,ownDataValue(snapshot,key)])) as ExternalDeliveryQueueSnapshot;
 const thresholds={pendingDue:Number(pendingDueThreshold),leasedExpired:Number(expiredLeaseThreshold),terminalFailed:Number(terminalFailedThreshold)};
 const results:ExternalDeliveryAlert[]=[];
 // Any contradictory durable state needs attention regardless of fleet size.
 if(counts.inconsistent>0){
  results.push({
   code:'QUEUE_INCONSISTENT',severity:'critical',
   observed:counts.inconsistent,threshold:1,
  });
 }
 if(counts.leasedExpired>=thresholds.leasedExpired){
  results.push({
   code:'EXPIRED_LEASES',severity:'warning',
   observed:counts.leasedExpired,threshold:thresholds.leasedExpired,
  });
 }
 if(counts.terminalFailed>=thresholds.terminalFailed){
  results.push({
   code:'TERMINAL_FAILURES',severity:'warning',
   observed:counts.terminalFailed,threshold:thresholds.terminalFailed,
  });
 }
 if(counts.pendingDue>=thresholds.pendingDue){
  results.push({
   code:'DUE_BACKLOG',severity:'warning',
   observed:counts.pendingDue,threshold:thresholds.pendingDue,
  });
 }
 return results;
}
