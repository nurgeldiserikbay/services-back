import type {PoolClient} from 'pg';
import type {ExternalProvider,ExternalDeliveryOutcome} from './external-provider-reconciliation.js';
import {processOneExternalNotification} from './external-delivery-worker.js';

type TransactionDatabase=Readonly<{
 transaction:<T>(fn:(client:PoolClient)=>Promise<T>)=>Promise<T>;
}>;
type Outcome=ExternalDeliveryOutcome;
const OUTCOMES=['SENT','RETRY_SCHEDULED','FAILED','DEFERRED','LEASE_LOST'] as const;

/**
 * One explicitly invoked, bounded batch. No interval, daemon, HTTP route,
 * provider credentials or side-effecting import.
 *
 * Sequential processing deliberately limits in-flight external provider
 * requests to one. No personally identifying data is returned or logged.
 * Callers MUST supply a real idempotent provider and externally supervise
 * failures. Database/network exceptions propagate (unknown COMMIT must never
 * be disguised as a successful empty batch).
 */
export type ExternalDeliveryBatchSummary=Readonly<{
 examined:number;
 exhausted:boolean;
 sent:number;
 retryScheduled:number;
 failed:number;
 deferred:number;
 leaseLost:number;
}>;

export async function processExternalNotificationBatch(
 database:TransactionDatabase,
 provider:ExternalProvider,
 maxItems=10,
 leaseSeconds=90,
 signal?:AbortSignal,
):Promise<ExternalDeliveryBatchSummary>{
 if(!Number.isSafeInteger(maxItems)||maxItems<1||maxItems>25)
  throw new RangeError('invalid_external_delivery_batch_limit');
 if(!Number.isSafeInteger(leaseSeconds)||leaseSeconds<30||leaseSeconds>300)
  throw new RangeError('invalid_external_delivery_lease_seconds');
 if(!database||typeof database.transaction!=='function'||
    !provider||provider.supportsIdempotentSend!==true||
    typeof provider.reconcile!=='function'||typeof provider.send!=='function')
  throw new Error('external_provider_idempotency_required');
 if(signal!==undefined&&
    (typeof signal.aborted!=='boolean'||typeof signal.throwIfAborted!=='function'))
  throw new Error('invalid_external_delivery_abort_signal');

 const counts:Record<Outcome,number>={
  SENT:0,RETRY_SCHEDULED:0,FAILED:0,DEFERRED:0,LEASE_LOST:0,
 };
 let examined=0;
 let exhausted=false;
 while(examined<maxItems){
  // Cancelling mid-batch prevents a new claim. A provider call already in
  // progress is allowed to finish and durably acknowledge its outcome.
  signal?.throwIfAborted();
  const outcome=await processOneExternalNotification(database,provider,leaseSeconds);
  if(outcome==='NO_WORK'){
   exhausted=true;
   break;
  }
  if(!OUTCOMES.includes(outcome))throw new Error('invalid_external_delivery_outcome');
  counts[outcome]++;
  examined++;
 }
 return {
  examined,exhausted,
  sent:counts.SENT,
  retryScheduled:counts.RETRY_SCHEDULED,
  failed:counts.FAILED,
  deferred:counts.DEFERRED,
  leaseLost:counts.LEASE_LOST,
 };
}
