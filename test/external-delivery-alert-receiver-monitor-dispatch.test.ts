import {test} from 'node:test';
import assert from 'node:assert/strict';
import {dispatchExternalAlertReceiverMonitoring}
 from '../src/modules/notifications/external-delivery-alert-receiver-monitor-dispatch.js';

const fields=['ready','retry_scheduled','leased_active','leased_expired',
 'terminal','acknowledged','inconsistent','total'] as const;
const policy=()=>({retryScheduled:1,leasedExpired:1,terminal:1,inconsistent:1});
const row=(data:Record<string,string>={})=>Object.fromEntries(
 fields.map(key=>[key,data[key]??'0']));
const dbFor=(values:Record<string,string>)=>({query:async()=>({
 rows:[row(values)],
})}) as never;

test('explicit receiver alert transport gets only frozen count-only breaches',async()=>{
 let calls=0;
 let captured:unknown;
 const db=dbFor({retry_scheduled:'1',terminal:'1',total:'2'});
 const transport={send:async(breaches:unknown)=>{
  calls++;captured=breaches;
  assert.equal(Object.isFrozen(breaches),true);
  assert.equal(Object.isFrozen((breaches as object[])[0]),true);
 }};
 const result=await dispatchExternalAlertReceiverMonitoring(
  db,'private-staging-scope',policy(),transport);
 assert.equal(calls,1);
 assert.deepEqual(result,[
  {code:'RETRY_BACKLOG',observed:1,threshold:1},
  {code:'TERMINAL_FAILURES',observed:1,threshold:1},
 ]);
 assert.equal(captured,result);
 const serialized=JSON.stringify(result);
 for(const forbidden of ['private-staging-scope','id','token','email','payload'])
  assert.equal(serialized.includes(forbidden),false);
});

test('empty observation does not call transport and returns frozen empty list',async()=>{
 let sends=0;
 const result=await dispatchExternalAlertReceiverMonitoring(
  dbFor({ready:'2',total:'2'}),'staging-kz',policy(),
  {send:async()=>{sends++;}});
 assert.deepEqual(result,[]);
 assert.equal(Object.isFrozen(result),true);
 assert.equal(sends,0);
});

test('receiver dispatch rejects accessor, unexpected transport keys before SQL',async()=>{
 let queries=0,accesses=0;
 const db={query:async()=>{queries++;throw Error('unexpected SQL');}} as never;
 const traps=[
  null,
  {send:'not a function'},
  {send:async()=>{},secret:'extra'},
  Object.defineProperty({},'send',{get(){accesses++;throw Error('getter invoked');}}),
 ];
 for(const transport of traps)
  await assert.rejects(dispatchExternalAlertReceiverMonitoring(
   db,'staging-kz',policy(),transport as never),
   /invalid_external_alert_receiver_monitor_transport/);
 assert.equal(queries,0);
 assert.equal(accesses,0);
});

test('invalid threshold fails before any send; malformed SQL cannot be sent',async()=>{
 let sent=0,reads=0;
 const transport={send:async()=>{sent++;}};
 await assert.rejects(dispatchExternalAlertReceiverMonitoring(
  {query:async()=>{reads++;throw Error('unexpected');}} as never,
  'staging-kz',{...policy(),terminal:0},transport),
  /invalid_external_alert_receiver_monitor_policy/);
 assert.equal(reads,0);
 const bad=dbFor({ready:'1',total:'0'});
 await assert.rejects(dispatchExternalAlertReceiverMonitoring(
  bad,'staging-kz',policy(),transport),
  /invalid_external_alert_receiver_monitor_snapshot/);
 assert.equal(sent,0);
});

test('provider rejection and PostgreSQL errors propagate without false delivery',async()=>{
 const db=dbFor({inconsistent:'1',total:'1'});
 await assert.rejects(dispatchExternalAlertReceiverMonitoring(
  db,'staging-kz',policy(),{send:async()=>{throw Error('transport unavailable');}}),
  /transport unavailable/);
 await assert.rejects(dispatchExternalAlertReceiverMonitoring(
  {query:async()=>{throw Error('database unavailable');}} as never,
  'staging-kz',policy(),{send:async()=>{throw Error('must not send');}}),
  /database unavailable/);
});
