import {readReceiverMonitorPreviewSettings}
 from './external-delivery-alert-receiver-monitor-preview-settings.js';
import {createReceiverMonitorHttpsTransport}
 from './external-delivery-alert-receiver-monitor-https-transport.js';

/**
 * Operator-supplied staging-only settings for an explicitly invoked single
 * dispatch. Two acknowledgements are required, with no defaults.
 * This parser performs no network/database action and never returns secrets in
 * an error message.
 */
export function readReceiverMonitorSendSettings(
 env:Readonly<Record<string,string|undefined>>,
):Readonly<{
 receiverScope:string;
 thresholds:Readonly<{
  retryScheduled:string;leasedExpired:string;terminal:string;inconsistent:string;
 }>;
 endpoint:string;
 approvedHostname:string;
 bearerToken:string;
 timeoutMs:number;
}>{
 const invalid=()=>{throw new Error('invalid_external_alert_receiver_send_config');};
 if(!env||typeof env!=='object'||Array.isArray(env))return invalid();
 const read=(key:string):string=>{
  const property=Object.getOwnPropertyDescriptor(env,key);
  if(!property||!Object.hasOwn(property,'value')||
     typeof property.value!=='string')return invalid();
  return property.value;
 };
 // Never let the dry-run acknowledgment alone authorize outbound delivery.
 if(read('RECEIVER_MONITOR_SEND_ACK')!=='SEND_ONCE_STAGING')return invalid();
 if(read('RECEIVER_MONITOR_ENVIRONMENT')!=='staging')return invalid();
 const runtime=Object.getOwnPropertyDescriptor(env,'NODE_ENV');
 if(runtime&&(!Object.hasOwn(runtime,'value')||
    typeof runtime.value!=='string'||runtime.value==='production'))return invalid();
 let receiverScope:string;
 let thresholds:ReturnType<typeof readReceiverMonitorPreviewSettings>['thresholds'];
 try{
  ({receiverScope,thresholds}=readReceiverMonitorPreviewSettings(env));
 }catch{return invalid();}
 const endpoint=read('RECEIVER_MONITOR_ENDPOINT');
 const approvedHostname=read('RECEIVER_MONITOR_APPROVED_HOSTNAME');
 const bearerToken=read('RECEIVER_MONITOR_BEARER_TOKEN');
 const timeout=read('RECEIVER_MONITOR_TIMEOUT_MS');
 if(!/^[1-9][0-9]{3,4}$/.test(timeout))return invalid();
 const timeoutMs=Number(timeout);
 // Use the exact adapter validation, so no database I/O can precede
 // URL/hostname/secret/timeout checks.
 try{
  createReceiverMonitorHttpsTransport({
   endpoint,approvedHostname,bearerToken,timeoutMs,
  });
 }catch{return invalid();}
 return Object.freeze({
  receiverScope,thresholds,endpoint,approvedHostname,bearerToken,timeoutMs,
 });
}
