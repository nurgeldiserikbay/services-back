import type {PoolClient} from 'pg';
import {readExternalDeliveryQueueSnapshot}
 from './external-delivery-monitoring.js';
import {evaluateExternalDeliveryQueueAlerts}
 from './external-delivery-alerts.js';
import type {ExternalDeliveryAlert,ExternalDeliveryAlertPolicy}
 from './external-delivery-alerts.js';

/**
 * Explicitly invoked internal boundary for an operator-controlled monitoring job.
 * The caller must provide a reviewed threshold policy and a real, authorized
 * transport. There is no default provider, schedule, public endpoint, or log.
 *
 * The transport sees only allowlisted aggregate signals. Its rejection is
 * propagated so the owner of the job can record an operational failure.
 */
export type ExternalDeliveryAlertTransport=Readonly<{
 send:(alerts:ReadonlyArray<ExternalDeliveryAlert>)=>Promise<void>;
}>;

export async function dispatchExternalDeliveryQueueAlerts(
 client:Pick<PoolClient,'query'>,
 policy:ExternalDeliveryAlertPolicy,
 transport:ExternalDeliveryAlertTransport,
):Promise<ReadonlyArray<ExternalDeliveryAlert>>{
 if(!transport||typeof transport!=='object'){
  throw new Error('invalid_external_delivery_alert_transport');
 }
 const send=Object.getOwnPropertyDescriptor(transport,'send');
 if(!send||!Object.hasOwn(send,'value')||typeof send.value!=='function'){
  throw new Error('invalid_external_delivery_alert_transport');
 }
 // A query or invalid policy must fail before any external side effect.
 const snapshot=await readExternalDeliveryQueueSnapshot(client);
 const alerts=evaluateExternalDeliveryQueueAlerts(snapshot,policy);
 if(alerts.length===0)return [];
 const safeAlerts=Object.freeze(alerts.map(alert=>Object.freeze({...alert})));
 await (send.value as ExternalDeliveryAlertTransport['send']).call(transport,safeAlerts);
 return safeAlerts;
}
