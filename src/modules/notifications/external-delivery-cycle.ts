import type {PoolClient} from 'pg';
import {stageNotificationDeliveries} from './outbox-staging.js';
import {processExternalNotificationBatch} from './external-delivery-batch.js';
import type {ExternalProvider} from './external-provider-reconciliation.js';

type TransactionDatabase=Readonly<{
 transaction:<T>(fn:(client:PoolClient)=>Promise<T>)=>Promise<T>;
}>;

export type ExternalDeliveryCycleSummary=Readonly<{
 eventsVisited:number;
 deliveriesCreated:number;
 examined:number;
 exhausted:boolean;
 sent:number;
 retryScheduled:number;
 failed:number;
 deferred:number;
 leaseLost:number;
}>;

/**
 * An explicitly invoked, bounded bridge from outbox staging to external
 * EMAIL/SMS delivery processing. Import does not schedule or send anything.
 *
 * Staging commits BEFORE delivery claims and any provider I/O. The provider
 * must be injected and checked BEFORE staging so a misconfigured host cannot
 * create extra work. Failure to commit staging propagates and prevents send.
 *
 * This is not a scheduler or a real provider adapter. A production host must
 * supply idempotent provider reconciliation, durable credentials and rollout
 * gates. Abort does not roll back previously committed staging or successful
 * provider acknowledgements.
 */
export async function runExternalNotificationCycle(
 database:TransactionDatabase,
 provider:ExternalProvider,
 maxEvents=25,
 maxDeliveries=10,
 leaseSeconds=90,
 signal?:AbortSignal,
):Promise<ExternalDeliveryCycleSummary>{
 if(!Number.isSafeInteger(maxEvents)||maxEvents<1||maxEvents>50)
  throw new RangeError('invalid_external_delivery_stage_limit');
 if(!Number.isSafeInteger(maxDeliveries)||maxDeliveries<1||maxDeliveries>25)
  throw new RangeError('invalid_external_delivery_batch_limit');
 if(!Number.isSafeInteger(leaseSeconds)||leaseSeconds<30||leaseSeconds>300)
  throw new RangeError('invalid_external_delivery_lease_seconds');
 if(signal!==undefined&&
    (typeof signal.aborted!=='boolean'||typeof signal.throwIfAborted!=='function'))
  throw new Error('invalid_external_delivery_abort_signal');
 if(!database||typeof database.transaction!=='function'||
    !provider||provider.supportsIdempotentSend!==true||
    typeof provider.reconcile!=='function'||typeof provider.send!=='function')
  throw new Error('external_provider_idempotency_required');
 signal?.throwIfAborted();
 const staged=await database.transaction(client=>stageNotificationDeliveries(client,maxEvents));
 // Aborting now leaves durable PENDING staging intact for the next run.
 signal?.throwIfAborted();
 const delivered=await processExternalNotificationBatch(
  database,provider,maxDeliveries,leaseSeconds,signal);
 return {...staged,...delivered};
}
