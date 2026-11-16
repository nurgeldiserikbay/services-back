import type {PoolClient} from 'pg';
import {claimExternalDelivery} from './external-delivery-lease.js';
import {reconcileAndSendClaimedExternalDelivery,
 type ExternalProvider,type ExternalDeliveryOutcome}
 from './external-provider-reconciliation.js';

type TransactionDatabase=Readonly<{
 transaction:<T>(fn:(client:PoolClient)=>Promise<T>)=>Promise<T>;
}>;

/**
 * Internal, one-shot worker integration point.
 *
 * The claim transaction commits BEFORE provider I/O. No automatic scheduler,
 * HTTP route, or provider configuration is installed. Production must inject
 * an audited adapter with real idempotent send and status reconciliation.
 * No email address, phone number, payload or provider secret crosses here.
 *
 * Providers which do not guarantee stable-key idempotency are rejected before
 * a database lease is claimed.
 */
export async function processOneExternalNotification(
 database:TransactionDatabase,
 provider:ExternalProvider,
 leaseSeconds=90,
):Promise<ExternalDeliveryOutcome|'NO_WORK'>{
 if(!database||typeof database.transaction!=='function'||
    !provider||provider.supportsIdempotentSend!==true||
    typeof provider.reconcile!=='function'||typeof provider.send!=='function')
  throw new Error('external_provider_idempotency_required');
 if(!Number.isSafeInteger(leaseSeconds)||leaseSeconds<30||leaseSeconds>300)
  throw new RangeError('invalid_external_delivery_lease_seconds');

 const claim=await database.transaction(client=>claimExternalDelivery(client,leaseSeconds));
 if(!claim)return 'NO_WORK';
 // Never call the provider inside a database transaction; a slow or lost
 // acknowledgement must not leave PostgreSQL locks open.
 return reconcileAndSendClaimedExternalDelivery(database,provider,claim);
}
