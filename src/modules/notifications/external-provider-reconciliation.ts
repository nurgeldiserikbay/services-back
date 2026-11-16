import type {PoolClient} from 'pg';
import type {ExternalDeliveryClaim} from './external-delivery-lease.js';
import {acknowledgeClaimedExternalDeliverySent} from './external-delivery-ack.js';
import {failClaimedExternalDelivery} from './external-delivery-lease.js';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * The provider adapter MUST support a durable idempotency key for sends,
 * and MUST reconcile a key across timeouts, retries, and process restarts.
 * An unsupported provider cannot be used by this coordinator.
 */
export type ExternalProvider=Readonly<{
  supportsIdempotentSend:true;
  reconcile:(key:string,channel:'EMAIL'|'SMS')=>Promise<'ACCEPTED'|'NOT_FOUND'|'UNKNOWN'>;
  send:(claim:Readonly<{intentId:string;channel:'EMAIL'|'SMS';idempotencyKey:string}>)=>
   Promise<'ACCEPTED'|'REJECTED'|'UNKNOWN'>;
}>;

export type ExternalDeliveryOutcome='SENT'|'RETRY_SCHEDULED'|'FAILED'|'DEFERRED'|'LEASE_LOST';
export type ExternalDeliveryTransaction=Readonly<{
 transaction:<T>(work:(client:PoolClient)=>Promise<T>)=>Promise<T>;
}>;

/**
 * One already-claimed item. Claim transaction MUST have committed before this call.
 * No database transaction is held across provider I/O. The provider resolves the
 * destination securely; caller never passes contact data through this function.
 *
 * UNKNOWN (including network exceptions) never records a delivery failure or
 * assumes a safe resend. On later lease expiry, reconcile again before retrying
 * with the exact same key. Exactly-once requires actual provider guarantees.
 */
export async function reconcileAndSendClaimedExternalDelivery(
 database:ExternalDeliveryTransaction,
 provider:ExternalProvider,
 claim:ExternalDeliveryClaim,
 now:()=>Date=()=>new Date(),
):Promise<ExternalDeliveryOutcome>{
 if(!database||typeof database.transaction!=='function'||
    !provider||provider.supportsIdempotentSend!==true||
    typeof provider.reconcile!=='function'||typeof provider.send!=='function')
  throw new Error('external_provider_idempotency_required');
 if(!claim||!UUID.test(claim.deliveryId)||!UUID.test(claim.intentId)||
    !UUID.test(claim.leaseToken)||
    (claim.channel!=='EMAIL'&&claim.channel!=='SMS')||
    !(claim.leaseExpiresAt instanceof Date)||
    !Number.isFinite(claim.leaseExpiresAt.getTime()))
  throw new Error('invalid_external_delivery_claim');

 const key=claim.channel+':'+claim.intentId;
 let observed:'ACCEPTED'|'NOT_FOUND'|'UNKNOWN';
 try{
  const result=await provider.reconcile(key,claim.channel);
  observed=result==='ACCEPTED'||result==='NOT_FOUND'?result:'UNKNOWN';
 }catch{
  return 'DEFERRED';
 }
 if(observed==='UNKNOWN')return 'DEFERRED';
 if(observed==='NOT_FOUND'){
  try{
   const result=await provider.send({
    intentId:claim.intentId,channel:claim.channel,idempotencyKey:key,
   });
   if(result==='ACCEPTED')observed='ACCEPTED';
   else if(result==='REJECTED'){
    return database.transaction(async(client)=>{
     const outcome=await failClaimedExternalDelivery(
      client,claim.deliveryId,claim.leaseToken,now());
     return outcome?(outcome.state==='FAILED'?'FAILED':'RETRY_SCHEDULED'):'LEASE_LOST';
    });
   }else return 'DEFERRED';
  }catch{
   // The send may have reached the provider even when the response is lost.
   // Never treat a transport exception as a definitive provider rejection.
   return 'DEFERRED';
  }
 }
 if(observed!=='ACCEPTED')return 'DEFERRED';
 return database.transaction(async(client)=>{
  const result=await acknowledgeClaimedExternalDeliverySent(
   client,claim.deliveryId,claim.leaseToken);
  return result?'SENT':'LEASE_LOST';
 });
}
