import type {PoolClient} from 'pg';
import type {ReceiverMonitoringTransport}
 from './external-delivery-alert-receiver-monitor-dispatch.js';
import type {ReceiverMonitorBreach}
 from './external-delivery-alert-receiver-monitor-policy.js';
import {selectReceiverMonitoringDueBreaches,recordReceiverMonitoringDelivered}
 from './external-delivery-alert-receiver-monitor-delivery-state.js';

/**
 * Opt-in transport wrapper for a *manual*, operator-owned staging send.
 *
 * IMPORTANT: the caller must hold the same-scope PostgreSQL advisory lock
 * across the entire call, including HTTP and watermark update. Without it,
 * concurrent callers may both select an unsent breach.
 *
 * No defaults, background execution or production provider binding.
 */
export function createReceiverMonitoringCooldownTransport(
 db:Pick<PoolClient,'query'>,
 receiverScope:string,
 cooldownSeconds:number,
 transport:ReceiverMonitoringTransport,
):ReceiverMonitoringTransport{
 if(!transport||typeof transport!=='object'||Array.isArray(transport)||
    Reflect.ownKeys(transport).length!==1||
    !Object.hasOwn(transport,'send'))
  throw new Error('invalid_receiver_monitor_cooldown_transport');
 const method=Object.getOwnPropertyDescriptor(transport,'send');
 if(!method||!Object.hasOwn(method,'value')||
    typeof method.value!=='function')
  throw new Error('invalid_receiver_monitor_cooldown_transport');
 if(typeof receiverScope!=='string'||
    !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(receiverScope)||
    !Number.isSafeInteger(cooldownSeconds)||
    cooldownSeconds<60||cooldownSeconds>86400)
  throw new Error('invalid_receiver_monitor_cooldown_transport');
 return Object.freeze({
  send:async(breaches:readonly ReceiverMonitorBreach[]):Promise<void>=>{
   const due=await selectReceiverMonitoringDueBreaches(
    db,receiverScope,breaches,cooldownSeconds);
   if(due.length===0)return;
   // Only the HTTPS success path records the successful delivery watermark.
   await (method.value as ReceiverMonitoringTransport['send']).call(transport,due);
   await recordReceiverMonitoringDelivered(db,receiverScope,due);
  },
 });
}

/** No implicit cooldown: absent field means no suppression. */
export function readReceiverMonitoringOptionalCooldown(
 env:Readonly<Record<string,string|undefined>>,
):number|undefined{
 if(!env||typeof env!=='object'||Array.isArray(env))
  throw new Error('invalid_receiver_monitor_cooldown_config');
 const d=Object.getOwnPropertyDescriptor(env,'RECEIVER_MONITOR_COOLDOWN_SECONDS');
 if(!d)return undefined;
 if(!Object.hasOwn(d,'value')||typeof d.value!=='string'||
    !/^[1-9][0-9]{1,4}$/.test(d.value))
  throw new Error('invalid_receiver_monitor_cooldown_config');
 const seconds=Number(d.value);
 if(!Number.isSafeInteger(seconds)||seconds<60||seconds>86400)
  throw new Error('invalid_receiver_monitor_cooldown_config');
 return seconds;
}
