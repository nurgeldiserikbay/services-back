/**
 * Pure, operator-invoked retry policy for the durable receiver ingress worker.
 * No scheduler, network or SQL calls. A future receiver worker must persist
 * the selected retry deadline and check it while claiming rows.
 */
export type ReceiverAlertRetryPolicy=Readonly<{
 baseDelayMs:number;
 maxDelayMs:number;
 maxAttempts:number;
}>;

function ownData(source:object,key:string):unknown{
 const descriptor=Object.getOwnPropertyDescriptor(source,key);
 if(!descriptor||!Object.hasOwn(descriptor,'value'))
  throw new Error('invalid_external_alert_receiver_retry_policy');
 return descriptor.value as unknown;
}

export function decideExternalAlertReceiverRetry(
 policy:ReceiverAlertRetryPolicy,
 attempts:number,
):Readonly<{retry:boolean;delayMs:number|null}>{
 if(!policy||typeof policy!=='object')
  throw new Error('invalid_external_alert_receiver_retry_policy');
 const base=ownData(policy,'baseDelayMs');
 const max=ownData(policy,'maxDelayMs');
 const allowed=ownData(policy,'maxAttempts');
 if(typeof base!=='number'||!Number.isSafeInteger(base)||
    typeof max!=='number'||!Number.isSafeInteger(max)||
    typeof allowed!=='number'||!Number.isSafeInteger(allowed)||
    base<1000||base>300000||max<base||max>3600000||
    allowed<1||allowed>100||!Number.isSafeInteger(attempts)||
    attempts<1||attempts>2147483647)
  throw new Error('invalid_external_alert_receiver_retry_policy');
 if(attempts>=allowed)return Object.freeze({retry:false,delayMs:null});
 // Saturating integer arithmetic prevents overflow even with huge counters.
 let delay=base;
 for(let step=1;step<attempts&&delay<max;step++)
  delay=Math.min(max,delay*2);
 return Object.freeze({retry:true,delayMs:delay});
}
