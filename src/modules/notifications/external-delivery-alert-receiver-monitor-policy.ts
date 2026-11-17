import type {ReceiverIngressCounts} from './external-delivery-alert-receiver-monitoring.js';

/**
 * Offline, operator-configured evaluation of private aggregate inventory.
 * No HTTP route, scheduler, transport, database access or identity fields.
 * A threshold of 1 on "inconsistent" is a sensible suggested configuration,
 * but operational thresholds must be approved from staging measurements.
 */
export type ReceiverMonitorThresholds=Readonly<{
 retryScheduled:number;
 leasedExpired:number;
 terminal:number;
 inconsistent:number;
}>;

export type ReceiverMonitorBreach=Readonly<{
 code:'RETRY_BACKLOG'|'EXPIRED_LEASES'|'TERMINAL_FAILURES'|'INCONSISTENT_STATE';
 observed:number;
 threshold:number;
}>;

const COUNT_FIELDS=['ready','retryScheduled','leasedActive','leasedExpired',
 'terminal','acknowledged','inconsistent','total'] as const;
const THRESHOLD_FIELDS=['retryScheduled','leasedExpired','terminal','inconsistent'] as const;
const CODES=['RETRY_BACKLOG','EXPIRED_LEASES','TERMINAL_FAILURES','INCONSISTENT_STATE'] as const;

function readOwnInteger(source:object,key:string,min:number):number{
 const descriptor=Object.getOwnPropertyDescriptor(source,key);
 if(!descriptor||!Object.hasOwn(descriptor,'value')||
    typeof descriptor.value!=='number'||
    !Number.isSafeInteger(descriptor.value)||descriptor.value<min)
  throw new Error('invalid_external_alert_receiver_monitor_policy');
 return descriptor.value as number;
}

function assertExactFields(value:unknown,fields:readonly string[]):asserts value is object{
 if(!value||typeof value!=='object'||Array.isArray(value)||
    Reflect.ownKeys(value).length!==fields.length||
    Reflect.ownKeys(value).some(key=>typeof key!=='string'||!fields.includes(key)))
  throw new Error('invalid_external_alert_receiver_monitor_policy');
}

/** Fail closed before returning *any* alert, even for malformed unused fields. */
export function evaluateExternalAlertReceiverMonitor(
 counts:ReceiverIngressCounts,
 thresholds:ReceiverMonitorThresholds,
):readonly ReceiverMonitorBreach[]{
 assertExactFields(counts,COUNT_FIELDS);
 assertExactFields(thresholds,THRESHOLD_FIELDS);
 const numbers=COUNT_FIELDS.map(key=>readOwnInteger(counts,key,0));
 const total=numbers[7];
 // Avoid unsafe summation and reject mutually impossible inventory snapshots.
 if(numbers.slice(0,7).some(value=>value>total)||
    numbers.slice(0,7).reduce((sum,value)=>sum+BigInt(value),0n)!==BigInt(total))
  throw new Error('invalid_external_alert_receiver_monitor_policy');
 const limits=THRESHOLD_FIELDS.map(key=>readOwnInteger(thresholds,key,1));
 const breaches:ReceiverMonitorBreach[]=[];
 for(let index=0;index<THRESHOLD_FIELDS.length;index++){
  const observed=numbers[COUNT_FIELDS.indexOf(THRESHOLD_FIELDS[index])];
  if(observed>=limits[index])
   breaches.push(Object.freeze({code:CODES[index],
    observed,threshold:limits[index]}));
 }
 return Object.freeze(breaches);
}
