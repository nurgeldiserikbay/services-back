import {test} from 'node:test';
import assert from 'node:assert/strict';
import {dispatchConfiguredExternalAlertReceiverMonitoring}
 from '../src/modules/notifications/external-delivery-alert-receiver-monitor-configured-dispatch.js';

const raw=(terminal:string)=>({
 retryScheduled:'2',leasedExpired:'2',terminal,inconsistent:'2',
});
const row=(terminal:string,total:string)=>({
 ready:'0',retry_scheduled:'0',leased_active:'0',leased_expired:'0',
 terminal,acknowledged:'0',inconsistent:'0',total,
});

test('configured dispatch rejects malformed threshold fields before SQL or transport',async()=>{
 let queries=0,sends=0,accesses=0;
 const db={query:async()=>{queries++;throw Error('unexpected SQL');}} as never;
 const transport={send:async()=>{sends++;}};
 const getter=Object.defineProperty(raw('1'),'terminal',{
  get(){accesses++;throw Error('must not read accessor');},
 });
 for(const invalid of [
  null,raw('0'),raw('01'),{...raw('1'),extra:'secret'},
  {retryScheduled:'1',leasedExpired:'1',terminal:'1'},
  getter,
 ]){
  await assert.rejects(dispatchConfiguredExternalAlertReceiverMonitoring(
   db,'trusted-staging',invalid,transport),
   /invalid_external_alert_receiver_monitor_config/);
 }
 assert.equal(queries,0);
 assert.equal(sends,0);
 assert.equal(accesses,0);
});

test('configured dispatch returns frozen count-only breach signals and suppresses healthy policy',async()=>{
 let queries=0,sends=0;
 const db={query:async()=>{
  queries++;
  return {rows:[row('1','1')]};
 }} as never;
 const deliveries:unknown[]=[];
 const transport={send:async(value:unknown)=>{
  sends++;
  deliveries.push(value);
 }};
 const below=await dispatchConfiguredExternalAlertReceiverMonitoring(
  db,'trusted-staging',raw('2'),transport);
 assert.deepEqual(below,[]);
 assert.equal(Object.isFrozen(below),true);
 assert.equal(sends,0);
 const alert=await dispatchConfiguredExternalAlertReceiverMonitoring(
  db,'trusted-staging',raw('1'),transport);
 assert.deepEqual(alert,[{code:'TERMINAL_FAILURES',observed:1,threshold:1}]);
 assert.equal(Object.isFrozen(alert),true);
 assert.equal(Object.isFrozen(alert[0]),true);
 assert.equal(deliveries[0],alert);
 assert.equal(sends,1);
 assert.equal(queries,2);
 assert.equal(JSON.stringify(alert).includes('trusted-staging'),false);
});

test('configured dispatch rejects invalid scope before DB and propagates database and provider failures',async()=>{
 let queries=0,sends=0;
 const db={query:async()=>{
  queries++;
  return {rows:[row('1','1')]};
 }} as never;
 const transport={send:async()=>{sends++;throw Error('operator transport outage');}};
 await assert.rejects(dispatchConfiguredExternalAlertReceiverMonitoring(
  db,'BAD_SCOPE',raw('1'),transport),
  /invalid_external_alert_receiver_monitor_input/);
 assert.equal(queries,0);
 assert.equal(sends,0);
 await assert.rejects(dispatchConfiguredExternalAlertReceiverMonitoring(
  db,'trusted-staging',raw('1'),transport),
  /operator transport outage/);
 assert.equal(queries,1);
 assert.equal(sends,1);
 await assert.rejects(dispatchConfiguredExternalAlertReceiverMonitoring(
  {query:async()=>{throw Error('postgres disconnected');}} as never,
  'trusted-staging',raw('1'),transport),/postgres disconnected/);
 assert.equal(sends,1);
});
