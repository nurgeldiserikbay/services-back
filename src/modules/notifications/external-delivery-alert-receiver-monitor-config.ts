import type {ReceiverMonitorThresholds}
 from './external-delivery-alert-receiver-monitor-policy.js';

const FIELDS=['retryScheduled','leasedExpired','terminal','inconsistent'] as const;

/**
 * Strict opt-in staging configuration boundary. An operator must explicitly
 * supply all four thresholds as base-10 positive integer strings (for example,
 * from a reviewed deployment manifest). No implicit defaults or environment
 * access, database calls, schedules, logs or transport side effects.
 */
export function parseReceiverMonitorThresholds(
 raw:unknown,
):ReceiverMonitorThresholds{
 if(!raw||typeof raw!=='object'||Array.isArray(raw))
  throw new Error('invalid_external_alert_receiver_monitor_config');
 const keys=Reflect.ownKeys(raw);
 if(keys.length!==FIELDS.length||
    keys.some(key=>typeof key!=='string'||
     !FIELDS.includes(key as typeof FIELDS[number])))
  throw new Error('invalid_external_alert_receiver_monitor_config');
 const values=FIELDS.map(field=>{
  const descriptor=Object.getOwnPropertyDescriptor(raw,field);
  if(!descriptor||!Object.hasOwn(descriptor,'value'))
   throw new Error('invalid_external_alert_receiver_monitor_config');
  const value:unknown=descriptor.value;
  if(typeof value!=='string'||! /^[1-9][0-9]*$/.test(value)||
     value.length>16)
   throw new Error('invalid_external_alert_receiver_monitor_config');
  const parsed=Number(value);
  if(!Number.isSafeInteger(parsed)||parsed<1)
   throw new Error('invalid_external_alert_receiver_monitor_config');
  return parsed;
 });
 return Object.freeze({
  retryScheduled:values[0],
  leasedExpired:values[1],
  terminal:values[2],
  inconsistent:values[3],
 });
}
