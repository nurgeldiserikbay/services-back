import type {PoolClient} from 'pg';
import type {ReceiverMonitoringTransport}
 from './external-delivery-alert-receiver-monitor-dispatch.js';
import {dispatchConfiguredExternalAlertReceiverMonitoring}
 from './external-delivery-alert-receiver-monitor-configured-dispatch.js';
import {runWithReceiverMonitoringSessionLock}
 from './external-delivery-alert-receiver-monitor-send-lock.js';
import {createReceiverMonitoringCooldownTransport}
 from './external-delivery-alert-receiver-monitor-cooldown-transport.js';
import {clearRecoveredReceiverMonitoringDeliveryState}
 from './external-delivery-alert-receiver-monitor-delivery-state.js';

export type ReceiverMonitoringStagingSendCounts=Readonly<{
 breachCount:number;
 sentCount:number;
}>;

/**
 * One-shot operator-invoked staging send; no automatic transport activation.
 * breachCount is the count observed before optional cooldown filtering,
 * while sentCount is the number actually sent to the approved transport.
 * Both remain count-only (no scope, identifiers or provider response data).
 *
 * This counts transport successes, not durable provider acceptance or paging.
 */
export async function dispatchOneShotReceiverStagingMonitoring(
 db:Pick<PoolClient,'query'>,
 receiverScope:string,
 thresholds:unknown,
 transport:ReceiverMonitoringTransport,
 cooldownSeconds?:number,
):Promise<ReceiverMonitoringStagingSendCounts>{
 let sentCount=0;
 const countingTransport:ReceiverMonitoringTransport=Object.freeze({
  send:async(breaches)=>{
   await transport.send(breaches);
   sentCount=breaches.length;
  },
 });
 const breaches=await runWithReceiverMonitoringSessionLock(
  db,receiverScope,async()=>{
   const observed=await dispatchConfiguredExternalAlertReceiverMonitoring(
    db,receiverScope,thresholds,
    cooldownSeconds===undefined?countingTransport:
     createReceiverMonitoringCooldownTransport(
      db,receiverScope,cooldownSeconds,countingTransport));
   // Clear ONLY recovered codes, based on the full scoped observation.
   // Never use the filtered due subset or a failed observation for rearming.
   if(cooldownSeconds!==undefined)
    await clearRecoveredReceiverMonitoringDeliveryState(db,receiverScope,observed);
   return observed;
  });
 return Object.freeze({breachCount:breaches.length,sentCount});
}
