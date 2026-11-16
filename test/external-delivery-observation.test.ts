import {test} from 'node:test';
import assert from 'node:assert/strict';
import {observeExternalDeliveryQueue}
 from '../src/modules/notifications/external-delivery-observation.js';

const policy={
 pendingDueThreshold:2,expiredLeaseThreshold:1,terminalFailedThreshold:1,
};
const row={
 pending_due:'2',pending_scheduled:'0',leased_active:'0',
 leased_expired:'1',terminal_failed:'1',provider_accepted:'0',
 inconsistent:'1',total:'5',
};
function fixture(value:unknown=row){
 let reads=0;
 const db={query:async()=>{
  reads++;
  return {rows:[value]};
 }};
 return {db,reads:()=>reads};
}

test('observation publishes only count-based alerts in deterministic order',async()=>{
 const f=fixture(),published:unknown[]=[];
 const result=await observeExternalDeliveryQueue(f.db as never,policy,
  async alert=>{published.push(alert);},new AbortController().signal);
 assert.deepEqual(result,{alertsPublished:4});
 assert.equal(f.reads(),1);
 assert.deepEqual(published.map((v)=> (v as {code:string}).code),[
  'QUEUE_INCONSISTENT','EXPIRED_LEASES','TERMINAL_FAILURES','DUE_BACKLOG',
 ]);
 assert.deepEqual(Object.keys(published[0] as object).sort(),
  ['code','observed','severity','threshold']);
 assert.equal(JSON.stringify(published).includes('recipient'),false);
});

test('empty queue produces no alerts and acknowledges zero publications',async()=>{
 const f=fixture({...row,pending_due:'0',leased_expired:'0',
  terminal_failed:'0',inconsistent:'0',total:'0'});
 let published=0;
 assert.deepEqual(await observeExternalDeliveryQueue(f.db as never,policy,
  async()=>{published++;},new AbortController().signal),
  {alertsPublished:0});
 assert.equal(published,0);
});

test('abort and invalid controls fail before any SQL or alert transport',async()=>{
 const f=fixture();
 const controller=new AbortController();
 controller.abort();
 let calls=0;
 await assert.rejects(observeExternalDeliveryQueue(f.db as never,policy,
  async()=>{calls++;},controller.signal),/abort/i);
 await assert.rejects(observeExternalDeliveryQueue(f.db as never,policy,
  null as never,new AbortController().signal),
 /invalid_external_delivery_observation_control/);
 assert.equal(f.reads(),0);
 assert.equal(calls,0);
});

test('malformed SQL snapshot and policy cannot emit a false healthy signal',async()=>{
 for(const value of [null,{...row,total:'999'},{
  ...row,pending_due:'not-numeric',
 }]){
  const f=fixture(value);
  let published=0;
  await assert.rejects(observeExternalDeliveryQueue(f.db as never,
   policy,async()=>{published++;},new AbortController().signal),
  /invalid_notification_monitor_snapshot/);
  assert.equal(published,0);
 }
 const f=fixture();
 let published=0;
 await assert.rejects(observeExternalDeliveryQueue(f.db as never,
  {...policy,pendingDueThreshold:0},async()=>{published++;},
  new AbortController().signal),/invalid_external_delivery_alert_policy/);
 assert.equal(published,0);
});

test('publisher failures propagate and stop subsequent alerts',async()=>{
 const f=fixture();let calls=0;
 await assert.rejects(observeExternalDeliveryQueue(f.db as never,policy,
  async()=>{calls++;throw new Error('publisher unavailable');},
  new AbortController().signal),/publisher unavailable/);
 assert.equal(calls,1);
});

test('abort after first publication blocks all subsequent alerts',async()=>{
 const f=fixture(),controller=new AbortController();let calls=0;
 await assert.rejects(observeExternalDeliveryQueue(f.db as never,policy,
  async()=>{calls++;controller.abort();},controller.signal),/abort/i);
 assert.equal(calls,1);
});
