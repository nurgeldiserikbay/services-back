import type {PoolClient} from 'pg';
import {setTimeout as delay} from 'node:timers/promises';
import type {ExternalDeliveryAlert,ExternalDeliveryAlertPolicy}
 from './external-delivery-alerts.js';
import {observeExternalDeliveryQueue}
 from './external-delivery-observation.js';

export type ExternalObservationPollPolicy=Readonly<{
 maxTicks:number;
 intervalMs:number;
}>;

export type ExternalObservationPollSummary=Readonly<{
 ticks:number;
 alertsPublished:number;
}>;

/**
 * Opt-in, bounded monitoring session, not an installed scheduler.
 * The host is responsible for operator authorization, measured thresholds,
 * an idempotent/durable publisher, retries and alert suppression. Repeating
 * ticks can publish the same alert again; this API does not deduplicate.
 *
 * Each observation and its publication completes before the next begins.
 * Failure/abort propagates without claiming the whole poll succeeded.
 * A publisher already in flight cannot be unsent by aborting.
 */
export async function pollExternalDeliveryObservations(
 client:Pick<PoolClient,'query'>,
 thresholds:ExternalDeliveryAlertPolicy,
 publish:(alert:ExternalDeliveryAlert)=>Promise<void>,
 policy:ExternalObservationPollPolicy,
 signal:AbortSignal,
 wait:(ms:number,signal:AbortSignal)=>Promise<void>=async(ms,sig)=>{
  await delay(ms,undefined,{signal:sig});
 },
):Promise<ExternalObservationPollSummary>{
 if(!policy||!Number.isSafeInteger(policy.maxTicks)||
    policy.maxTicks<1||policy.maxTicks>20||
    !Number.isSafeInteger(policy.intervalMs)||
    policy.intervalMs<100||policy.intervalMs>60_000)
  throw new RangeError('invalid_external_observation_poll_policy');
 if(!signal||typeof signal.throwIfAborted!=='function'||
    typeof signal.aborted!=='boolean'||typeof wait!=='function')
  throw new Error('invalid_external_observation_poll_control');
 if(!client||typeof client.query!=='function'||typeof publish!=='function')
  throw new Error('invalid_external_delivery_observation_control');
 let ticks=0,alertsPublished=0;
 for(let index=0;index<policy.maxTicks;index++){
  signal.throwIfAborted();
  if(index>0){
   await wait(policy.intervalMs,signal);
   signal.throwIfAborted();
  }
  const result=await observeExternalDeliveryQueue(
   client,thresholds,publish,signal);
  ticks++;
  alertsPublished+=result.alertsPublished;
  signal.throwIfAborted();
 }
 return {ticks,alertsPublished};
}
