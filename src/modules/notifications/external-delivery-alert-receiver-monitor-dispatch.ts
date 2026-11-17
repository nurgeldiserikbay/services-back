import type {PoolClient} from 'pg';
import {observeExternalAlertReceiver}
 from './external-delivery-alert-receiver-observation.js';
import type {ReceiverMonitorBreach,ReceiverMonitorThresholds}
 from './external-delivery-alert-receiver-monitor-policy.js';

/** A caller-owned, explicitly approved internal alert sink; no default provider. */
export type ReceiverMonitoringTransport=Readonly<{
 send:(breaches:readonly ReceiverMonitorBreach[])=>Promise<void>;
}>;

/**
 * Explicit one-shot internal monitoring dispatch. It never registers a route,
 * background task, or external provider. The trusted caller supplies scope,
 * measured/approved thresholds and a transport. The transport receives only
 * a fresh frozen allowlist of aggregate breaches, never the scope or SQL rows.
 * Errors propagate: a failed send must not be recorded as delivered.
 */
export async function dispatchExternalAlertReceiverMonitoring(
 db:Pick<PoolClient,'query'>,
 receiverScope:string,
 thresholds:ReceiverMonitorThresholds,
 transport:ReceiverMonitoringTransport,
):Promise<readonly ReceiverMonitorBreach[]>{
 if(!transport||typeof transport!=='object'||Array.isArray(transport))
  throw new Error('invalid_external_alert_receiver_monitor_transport');
 const keys=Reflect.ownKeys(transport);
 if(keys.length!==1||keys[0]!=='send')
  throw new Error('invalid_external_alert_receiver_monitor_transport');
 const descriptor=Object.getOwnPropertyDescriptor(transport,'send');
 if(!descriptor||!Object.hasOwn(descriptor,'value')||
    typeof descriptor.value!=='function')
  throw new Error('invalid_external_alert_receiver_monitor_transport');
 const observation=await observeExternalAlertReceiver(db,receiverScope,thresholds);
 if(observation.breaches.length===0)return Object.freeze([]);
 // Rebuild the output from known scalar properties, not the database object.
 const safe=Object.freeze(observation.breaches.map(breach=>Object.freeze({
  code:breach.code,observed:breach.observed,threshold:breach.threshold,
 })));
 await (descriptor.value as ReceiverMonitoringTransport['send']).call(transport,safe);
 return safe;
}
