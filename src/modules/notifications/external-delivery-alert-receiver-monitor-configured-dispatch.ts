import type {PoolClient} from 'pg';
import {parseReceiverMonitorThresholds}
 from './external-delivery-alert-receiver-monitor-config.js';
import {dispatchExternalAlertReceiverMonitoring,
 type ReceiverMonitoringTransport}
 from './external-delivery-alert-receiver-monitor-dispatch.js';
import type {ReceiverMonitorBreach}
 from './external-delivery-alert-receiver-monitor-policy.js';

/**
 * Operator-invoked, opt-in bridge between untrusted deployment threshold
 * configuration and private, count-only receiver alert delivery.
 *
 * The caller, not this module, authenticates its deployment scope and owns
 * the transport. The complete four-field threshold configuration is checked
 * before any SQL or provider interaction. No defaults, schedules or endpoints.
 */
export async function dispatchConfiguredExternalAlertReceiverMonitoring(
 db:Pick<PoolClient,'query'>,
 receiverScope:string,
 rawThresholds:unknown,
 transport:ReceiverMonitoringTransport,
):Promise<readonly ReceiverMonitorBreach[]>{
 const thresholds=parseReceiverMonitorThresholds(rawThresholds);
 return dispatchExternalAlertReceiverMonitoring(
  db,receiverScope,thresholds,transport);
}
