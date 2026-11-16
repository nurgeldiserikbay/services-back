import type {PoolClient} from 'pg';
import {setTimeout as delay} from 'node:timers/promises';
import type {ExternalProvider} from './external-provider-reconciliation.js';
import {processExternalNotificationBatch}
 from './external-delivery-batch.js';

type TransactionDatabase=Readonly<{
 transaction:<T>(fn:(client:PoolClient)=>Promise<T>)=>Promise<T>;
}>;

export type ExternalDeliveryPollPolicy=Readonly<{
 maxTicks:number;
 intervalMs:number;
 maxItemsPerTick:number;
 leaseSeconds:number;
}>;

export type ExternalDeliveryPollSummary=Readonly<{
 ticks:number;
 examined:number;
 sent:number;
 retryScheduled:number;
 failed:number;
 deferred:number;
 leaseLost:number;
}>;

/**
 * Explicitly invoked, bounded polling session. Importing this module never
 * starts a worker, timer, or delivery. The caller must provide an idempotent
 * provider, approved policy, and an AbortSignal controlled by the host.
 *
 * Sequential awaiting guarantees no overlapping batches within this session.
 * External provider errors and database/COMMIT failures are not swallowed;
 * the host is responsible for crash reporting and orchestration. Aborting
 * cannot unsend a provider call already in progress.
 */
export async function runExternalNotificationPolling(
 database:TransactionDatabase,
 provider:ExternalProvider,
 policy:ExternalDeliveryPollPolicy,
 signal:AbortSignal,
 wait:(ms:number,signal:AbortSignal)=>Promise<void>=async(ms,sig)=>{
  await delay(ms,undefined,{signal:sig});
 },
):Promise<ExternalDeliveryPollSummary>{
 if(!policy||!Number.isSafeInteger(policy.maxTicks)||
    policy.maxTicks<1||policy.maxTicks>100||
    !Number.isSafeInteger(policy.intervalMs)||
    policy.intervalMs<100||policy.intervalMs>60_000||
    !Number.isSafeInteger(policy.maxItemsPerTick)||
    policy.maxItemsPerTick<1||policy.maxItemsPerTick>25||
    policy.maxTicks*policy.maxItemsPerTick>250||
    !Number.isSafeInteger(policy.leaseSeconds)||
    policy.leaseSeconds<30||policy.leaseSeconds>300)
  throw new RangeError('invalid_external_delivery_poll_policy');
 if(!signal||typeof signal.aborted!=='boolean'||
    typeof signal.throwIfAborted!=='function'||typeof wait!=='function')
  throw new Error('invalid_external_delivery_poll_control');
 // Validate before waiting or invoking any database transaction.
 if(!database||typeof database.transaction!=='function'||
    !provider||provider.supportsIdempotentSend!==true||
    typeof provider.reconcile!=='function'||typeof provider.send!=='function')
  throw new Error('external_provider_idempotency_required');
 const totals={
  ticks:0,examined:0,sent:0,retryScheduled:0,
  failed:0,deferred:0,leaseLost:0,
 };
 for(let index=0;index<policy.maxTicks;index++){
  signal.throwIfAborted();
  if(index>0){
   await wait(policy.intervalMs,signal);
   signal.throwIfAborted();
  }
  const batch=await processExternalNotificationBatch(
   database,provider,policy.maxItemsPerTick,policy.leaseSeconds,signal);
  totals.ticks++;
  totals.examined+=batch.examined;
  totals.sent+=batch.sent;
  totals.retryScheduled+=batch.retryScheduled;
  totals.failed+=batch.failed;
  totals.deferred+=batch.deferred;
  totals.leaseLost+=batch.leaseLost;
 }
 return totals;
}
