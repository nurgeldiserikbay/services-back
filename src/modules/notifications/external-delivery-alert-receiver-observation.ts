import type {PoolClient} from 'pg';
import {readExternalAlertReceiverCounts,
 type ReceiverIngressCounts}
 from './external-delivery-alert-receiver-monitoring.js';
import {evaluateExternalAlertReceiverMonitor,
 type ReceiverMonitorBreach,type ReceiverMonitorThresholds}
 from './external-delivery-alert-receiver-monitor-policy.js';

export type ReceiverMonitorObservation=Readonly<{
 counts:ReceiverIngressCounts;
 breaches:readonly ReceiverMonitorBreach[];
}>;

/**
 * Opt-in internal observation: one scope-bound, count-only PostgreSQL snapshot
 * plus explicit, operator-supplied thresholds. No public endpoint, scheduler,
 * webhook, email or provider I/O. Invalid policies fail before database access.
 * A query failure propagates; never silently interpret it as a healthy queue.
 */
export async function observeExternalAlertReceiver(
 db:Pick<PoolClient,'query'>,
 receiverScope:string,
 thresholds:ReceiverMonitorThresholds,
):Promise<ReceiverMonitorObservation>{
 // Validate policy independently of DB side effects, using a valid zero
 // snapshot. Both the evaluator and DB reader inspect own data properties.
 evaluateExternalAlertReceiverMonitor(Object.freeze({
  ready:0,retryScheduled:0,leasedActive:0,leasedExpired:0,
  terminal:0,acknowledged:0,inconsistent:0,total:0,
 }),thresholds);
 const counts=await readExternalAlertReceiverCounts(db,receiverScope);
 const breaches=evaluateExternalAlertReceiverMonitor(counts,thresholds);
 return Object.freeze({counts,breaches});
}
