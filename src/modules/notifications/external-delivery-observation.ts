import type {PoolClient} from 'pg';
import {readExternalDeliveryQueueSnapshot} from './external-delivery-monitoring.js';
import {evaluateExternalDeliveryQueueAlerts,
 type ExternalDeliveryAlert,type ExternalDeliveryAlertPolicy}
 from './external-delivery-alerts.js';

/**
 * Explicit, single-shot observation hook. No scheduler or transport is
 * installed by importing this module. The host must provide an authorized,
 * durable alert publisher, measured thresholds and cancellation control.
 *
 * Only safe aggregate alerts cross the publisher boundary. Database faults,
 * malformed metrics and publisher failures propagate: an unsuccessful
 * observation must never be reported as healthy or delivered.
 */
export async function observeExternalDeliveryQueue(
 client:Pick<PoolClient,'query'>,
 policy:ExternalDeliveryAlertPolicy,
 publish:(alert:ExternalDeliveryAlert)=>Promise<void>,
 signal:AbortSignal,
):Promise<Readonly<{alertsPublished:number}>>{
 if(!client||typeof client.query!=='function'||
    typeof publish!=='function'||!signal||
    typeof signal.throwIfAborted!=='function'||
    typeof signal.aborted!=='boolean')
  throw new Error('invalid_external_delivery_observation_control');
 signal.throwIfAborted();
 const snapshot=await readExternalDeliveryQueueSnapshot(client);
 signal.throwIfAborted();
 const alerts=evaluateExternalDeliveryQueueAlerts(snapshot,policy);
 let published=0;
 for(const alert of alerts){
  signal.throwIfAborted();
  // Await each acknowledgement; no fire-and-forget or silent failure.
  await publish(alert);
  published++;
 }
 return {alertsPublished:published};
}
