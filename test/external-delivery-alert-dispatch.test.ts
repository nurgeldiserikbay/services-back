import {test} from 'node:test';
import assert from 'node:assert/strict';
import {dispatchExternalDeliveryQueueAlerts}
 from '../src/modules/notifications/external-delivery-alert-dispatch.js';

const policy={pendingDueThreshold:2,expiredLeaseThreshold:1,terminalFailedThreshold:1};
const empty={
 pending_due:'0',pending_scheduled:'0',leased_active:'0',
 leased_expired:'0',terminal_failed:'0',provider_accepted:'0',
 inconsistent:'0',total:'0',
};

test('dispatch is quiet for a healthy snapshot; never calls transport',async()=>{
 let sent=0;
 const result=await dispatchExternalDeliveryQueueAlerts({
  query:async()=>({rows:[empty]}),
 } as never,policy,{send:async()=>{sent++;}});
 assert.deepEqual(result,[]);
 assert.equal(sent,0);
});

test('dispatch sends only frozen aggregate alert data and returns it',async()=>{
 let sent:unknown;
 const result=await dispatchExternalDeliveryQueueAlerts({
  query:async()=>({rows:[{...empty,pending_due:'2',inconsistent:'1',total:'3'}]}),
 } as never,policy,{
  send:async alerts=>{sent=alerts;},
 });
 assert.deepEqual(result,[
  {code:'QUEUE_INCONSISTENT',severity:'critical',observed:1,threshold:1},
  {code:'DUE_BACKLOG',severity:'warning',observed:2,threshold:2},
 ]);
 assert.equal(sent,result);
 assert.equal(Object.isFrozen(result),true);
 assert.equal(result.every(Object.isFrozen),true);
 assert.deepEqual(Object.keys(result[0]).sort(),
  ['code','severity','observed','threshold'].sort());
 assert.equal(JSON.stringify(result).includes('recipient'),false);
});

test('malformed metrics or thresholds fail before sending',async()=>{
 let sent=0;
 const transport={send:async()=>{sent++;}};
 await assert.rejects(dispatchExternalDeliveryQueueAlerts({
  query:async()=>({rows:[{...empty,total:'2'}]}),
 } as never,policy,transport),/invalid_notification_monitor_snapshot/);
 await assert.rejects(dispatchExternalDeliveryQueueAlerts({
  query:async()=>({rows:[empty]}),
 } as never,{...policy,pendingDueThreshold:0},transport),
 /invalid_external_delivery_alert_policy/);
 assert.equal(sent,0);
});

test('missing transport or getter-backed send never executes a getter',async()=>{
 let reads=0;
 const trap=Object.defineProperty({},'send',{get(){
  reads++;throw new Error('must not read getter');
 }});
 const client={query:async()=>({rows:[empty]})} as never;
 await assert.rejects(dispatchExternalDeliveryQueueAlerts(
  client,policy,trap as never),/invalid_external_delivery_alert_transport/);
 await assert.rejects(dispatchExternalDeliveryQueueAlerts(
  client,policy,null as never),/invalid_external_delivery_alert_transport/);
 assert.equal(reads,0);
});

test('transport failures propagate rather than report a successful alert delivery',async()=>{
 const failure=new Error('transport unavailable');
 await assert.rejects(dispatchExternalDeliveryQueueAlerts({
  query:async()=>({rows:[{...empty,pending_due:'2',total:'2'}]}),
 } as never,policy,{send:async()=>{throw failure;}}),
 error=>error===failure);
});
