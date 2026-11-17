import {parseReceiverMonitorThresholds}
 from './external-delivery-alert-receiver-monitor-config.js';

const NAMES=['RECEIVER_MONITOR_RETRY_SCHEDULED',
 'RECEIVER_MONITOR_LEASED_EXPIRED',
 'RECEIVER_MONITOR_TERMINAL',
 'RECEIVER_MONITOR_INCONSISTENT'] as const;

export type ReceiverMonitorPreviewSettings=Readonly<{
 receiverScope:string;
 thresholds:Readonly<{
  retryScheduled:string;leasedExpired:string;terminal:string;inconsistent:string;
 }>;
}>;

/** No defaults, credentials or provider settings are part of this preview. */
export function readReceiverMonitorPreviewSettings(
 env:Readonly<Record<string,string|undefined>>,
):ReceiverMonitorPreviewSettings{
 if(!env||typeof env!=='object'||Array.isArray(env))
  throw new Error('invalid_external_alert_receiver_preview_config');
 const read=(key:string):string=>{
  const field=Object.getOwnPropertyDescriptor(env,key);
  if(!field||!Object.hasOwn(field,'value')||typeof field.value!=='string')
   throw new Error('invalid_external_alert_receiver_preview_config');
  return field.value;
 };
 const receiverScope=read('RECEIVER_MONITOR_SCOPE');
 if(!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(receiverScope))
  throw new Error('invalid_external_alert_receiver_preview_config');
 const [retryScheduled,leasedExpired,terminal,inconsistent]=NAMES.map(read);
 const thresholds=Object.freeze({
  retryScheduled,leasedExpired,terminal,inconsistent,
 });
 try{
  parseReceiverMonitorThresholds(thresholds);
 }catch{
  throw new Error('invalid_external_alert_receiver_preview_config');
 }
 return Object.freeze({receiverScope,thresholds});
}
