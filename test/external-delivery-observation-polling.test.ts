import {test} from 'node:test';
import assert from 'node:assert/strict';
import {pollExternalDeliveryObservations}
 from '../src/modules/notifications/external-delivery-observation-polling.js';

const thresholds={
 pendingDueThreshold:1,expiredLeaseThreshold:1,terminalFailedThreshold:1,
};
const row={
 pending_due:'1',pending_scheduled:'0',leased_active:'0',
 leased_expired:'0',terminal_failed:'0',provider_accepted:'0',
 inconsistent:'0',total:'1',
};
const policy={maxTicks:3,intervalMs:100};

test('bounded ticks are sequential and count only acknowledged alerts',async()=>{
 let reads=0,publishes=0,busy=false;
 const waits:number[]=[];
 const client={query:async()=>{
  assert.equal(busy,false,'no overlapping observations');
  reads++;
  return {rows:[row]};
 }};
 const summary=await pollExternalDeliveryObservations(
  client as never,thresholds,async alert=>{
   assert.equal(busy,false);
   busy=true;
   try{
    assert.equal(alert.code,'DUE_BACKLOG');
    publishes++;
    await Promise.resolve();
   }finally{busy=false;}
  },policy,new AbortController().signal,async ms=>{
   assert.equal(busy,false);
   waits.push(ms);
  });
 assert.deepEqual(summary,{ticks:3,alertsPublished:3});
 assert.equal(reads,3);
 assert.equal(publishes,3);
 assert.deepEqual(waits,[100,100]);
});

test('pre-abort and invalid controls fail before query, publish or wait',async()=>{
 let reads=0,publishes=0,waits=0;
 const client={query:async()=>{reads++;return {rows:[row]};}};
 const publish=async()=>{publishes++;};
 const wait=async()=>{waits++;};
 const controller=new AbortController();
 controller.abort();
 await assert.rejects(pollExternalDeliveryObservations(
  client as never,thresholds,publish,policy,controller.signal,wait),/abort/i);
 for(const bad of [
  {...policy,maxTicks:0},{...policy,maxTicks:21},
  {...policy,maxTicks:1.5},{...policy,intervalMs:99},
  {...policy,intervalMs:60_001},{...policy,intervalMs:NaN},
 ]){
  await assert.rejects(pollExternalDeliveryObservations(
   client as never,thresholds,publish,bad,
   new AbortController().signal,wait),RangeError);
 }
 assert.equal(reads,0);
 assert.equal(publishes,0);
 assert.equal(waits,0);
});

test('abort during wait prevents the next observation',async()=>{
 const controller=new AbortController();let reads=0;
 const client={query:async()=>{reads++;return {rows:[row]};}};
 await assert.rejects(pollExternalDeliveryObservations(
  client as never,thresholds,async()=>{},policy,controller.signal,
  async()=>{controller.abort();}),/abort/i);
 assert.equal(reads,1);
});

test('publisher failure stops immediately without next query or wait',async()=>{
 let reads=0,waits=0;
 const client={query:async()=>{reads++;return {rows:[row]};}};
 await assert.rejects(pollExternalDeliveryObservations(
  client as never,thresholds,async()=>{throw new Error('transport down');},
  policy,new AbortController().signal,async()=>{waits++;}),
 /transport down/);
 assert.equal(reads,1);
 assert.equal(waits,0);
});

test('malformed SQL metrics fail closed before publication or repeat',async()=>{
 let reads=0,publishes=0;
 const client={query:async()=>{reads++;return {rows:[{...row,total:'0'}]};}};
 await assert.rejects(pollExternalDeliveryObservations(
  client as never,thresholds,async()=>{publishes++;},policy,
  new AbortController().signal,async()=>{}),
 /invalid_notification_monitor_snapshot/);
 assert.equal(reads,1);
 assert.equal(publishes,0);
});

test('abort during last alert acknowledgement does not report completed poll',async()=>{
 const controller=new AbortController();let calls=0;
 const client={query:async()=>({rows:[row]})};
 await assert.rejects(pollExternalDeliveryObservations(
  client as never,thresholds,async()=>{calls++;controller.abort();},
  {...policy,maxTicks:1},controller.signal,async()=>{}),/abort/i);
 assert.equal(calls,1);
});


test('opt-in suppression emits first alert, stays quiet, and re-arms after recovery',async()=>{
 const sequence=[
  {...row,pending_due:'1',total:'1'},
  {...row,pending_due:'3',total:'3'},
  {...row,pending_due:'0',total:'0'},
  {...row,pending_due:'1',total:'1'},
 ];
 let index=0;
 const codes:string[]=[];
 const client={query:async()=>({rows:[sequence[index++]]})};
 const summary=await pollExternalDeliveryObservations(
  client as never,thresholds,async alert=>{codes.push(alert.code);},
  {maxTicks:4,intervalMs:100},new AbortController().signal,
  async()=>{},true);
 assert.deepEqual(summary,{ticks:4,alertsPublished:2});
 assert.deepEqual(codes,['DUE_BACKLOG','DUE_BACKLOG']);
 assert.equal(index,4);
});

test('suppression is invocation-scoped and default behavior remains unchanged',async()=>{
 const client={query:async()=>({rows:[row]})};
 const first=await pollExternalDeliveryObservations(
  client as never,thresholds,async()=>{},policy,
  new AbortController().signal,async()=>{},true);
 const second=await pollExternalDeliveryObservations(
  client as never,thresholds,async()=>{},policy,
  new AbortController().signal,async()=>{},true);
 const legacy=await pollExternalDeliveryObservations(
  client as never,thresholds,async()=>{},policy,
  new AbortController().signal,async()=>{});
 assert.deepEqual(first,{ticks:3,alertsPublished:1});
 assert.deepEqual(second,{ticks:3,alertsPublished:1});
 assert.deepEqual(legacy,{ticks:3,alertsPublished:3});
});

test('invalid suppression option fails before any SQL query',async()=>{
 let reads=0;
 const client={query:async()=>{reads++;return {rows:[row]};}};
 await assert.rejects(pollExternalDeliveryObservations(
  client as never,thresholds,async()=>{},
  policy,new AbortController().signal,async()=>{},'yes' as never),
 /invalid_external_observation_suppression_policy/);
 assert.equal(reads,0);
});

test('suppression does not silently recover after malformed snapshot',async()=>{
 let reads=0,publishes=0;
 const client={query:async()=>{
  reads++;
  return {rows:[reads===2?{...row,total:'9'}:row]};
 }};
 await assert.rejects(pollExternalDeliveryObservations(
  client as never,thresholds,async()=>{publishes++;},
  policy,new AbortController().signal,async()=>{},true),
 /invalid_notification_monitor_snapshot/);
 assert.equal(reads,2);
 assert.equal(publishes,1);
});
