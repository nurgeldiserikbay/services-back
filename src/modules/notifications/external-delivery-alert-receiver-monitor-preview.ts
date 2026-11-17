import type {PoolClient} from 'pg';
import {parseReceiverMonitorThresholds}
 from './external-delivery-alert-receiver-monitor-config.js';
import {observeExternalAlertReceiver}
 from './external-delivery-alert-receiver-observation.js';
import type {ReceiverMonitorBreach}
 from './external-delivery-alert-receiver-monitor-policy.js';

/**
 * Explicit operator-invoked staging preview. Parses all threshold strings
 * before any SQL, reads counts only for a trusted deployment scope and returns
 * immutable allowlisted breaches. Does not accept or create a transport,
 * scheduler, public route, provider integration or implicit defaults.
 *
 * A preview is NOT proof that an alert destination works and must never be
 * recorded as delivered or as staging sign-off.
 */
export async function previewConfiguredExternalAlertReceiverMonitoring(
 db:Pick<PoolClient,'query'>,
 receiverScope:string,
 rawThresholds:unknown,
):Promise<readonly ReceiverMonitorBreach[]>{
 const thresholds=parseReceiverMonitorThresholds(rawThresholds);
 const {breaches}=await observeExternalAlertReceiver(db,receiverScope,thresholds);
 return Object.freeze(breaches.map(item=>Object.freeze({
  code:item.code,
  observed:item.observed,
  threshold:item.threshold,
 })));
}
