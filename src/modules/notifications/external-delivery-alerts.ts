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
  const count=snapshot[key];
  if(!Number.isSafeInteger(count)||count<0)
   throw new Error('invalid_external_delivery_alert_snapshot');
 }
 const total=COUNTS.slice(0,-1).reduce((sum,key)=>sum+snapshot[key],0);
 if(!Number.isSafeInteger(total)||total!==snapshot.total)
  throw new Error('invalid_external_delivery_alert_snapshot');
 for(const threshold of [
  policy.pendingDueThreshold,policy.expiredLeaseThreshold,
  policy.terminalFailedThreshold,
 ]){
  if(!Number.isSafeInteger(threshold)||threshold<1)
   throw new Error('invalid_external_delivery_alert_policy');
 }
 const results:ExternalDeliveryAlert[]=[];
 // Any contradictory durable state needs attention regardless of fleet size.
 if(snapshot.inconsistent>0){
  results.push({
   code:'QUEUE_INCONSISTENT',severity:'critical',
   observed:snapshot.inconsistent,threshold:1,
  });
 }
 if(snapshot.leasedExpired>=policy.expiredLeaseThreshold){
  results.push({
   code:'EXPIRED_LEASES',severity:'warning',
   observed:snapshot.leasedExpired,threshold:policy.expiredLeaseThreshold,
  });
 }
 if(snapshot.terminalFailed>=policy.terminalFailedThreshold){
  results.push({
   code:'TERMINAL_FAILURES',severity:'warning',
   observed:snapshot.terminalFailed,threshold:policy.terminalFailedThreshold,
  });
 }
 if(snapshot.pendingDue>=policy.pendingDueThreshold){
  results.push({
   code:'DUE_BACKLOG',severity:'warning',
   observed:snapshot.pendingDue,threshold:policy.pendingDueThreshold,
  });
 }
 return results;
}
