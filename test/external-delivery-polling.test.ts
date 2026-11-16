import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {runExternalNotificationPolling} from
 '../src/modules/notifications/external-delivery-polling.js';

const policy={maxTicks:3,intervalMs:100,maxItemsPerTick:2,leaseSeconds:90};

function fixture(count=0){
 let claims=0,sends=0,activeTransactions=0;
 const database={transaction:async<T>(fn:(client:never)=>Promise<T>):Promise<T>=>{
  assert.equal(activeTransactions,0,'no overlapping batches/transactions');
  activeTransactions++;
  try{
   return await fn({query:async(sql:string)=>{
    if(sql.includes('WITH candidate AS')){
     if(claims>=count)return {rows:[]};
     claims++;
     return {rows:[{
      id:randomUUID(),intent_id:randomUUID(),channel:'EMAIL',
      lease_expires_at:new Date(Date.now()+90_000),
     }]};
    }
    if(sql.includes('SELECT d.intent_id::text'))
     return {rows:[{intent_id:randomUUID(),channel:'EMAIL',
      attempt_count:0,intent_attempts:0,
      next_attempt_at:null,intent_next_attempt_at:null}]};
    if(sql.includes('UPDATE notification_deliveries')||
       sql.includes('UPDATE notification_intents'))return {rows:[{id:randomUUID()}]};
    throw new Error('unexpected SQL');
   }} as never);
  }finally{
   activeTransactions--;
  }
 }};
 const provider={
  supportsIdempotentSend:true as const,
  reconcile:async()=>{
   assert.equal(activeTransactions,0,'provider I/O outside DB transaction');
   return 'NOT_FOUND' as const;
  },
  send:async()=>{
   assert.equal(activeTransactions,0);
   sends++;
   return 'ACCEPTED' as const;
  },
 };
 return {database,provider,claims:()=>claims,sends:()=>sends};
}

test('explicit polling processes finite sequential ticks and counts only',async()=>{
 const f=fixture(4),intervals:number[]=[];
 const result=await runExternalNotificationPolling(f.database as never,f.provider,
  policy,new AbortController().signal,async(ms)=>{
   intervals.push(ms);
  });
 assert.deepEqual(result,{
  ticks:3,examined:4,sent:4,retryScheduled:0,
  failed:0,deferred:0,leaseLost:0,
 });
 assert.deepEqual(intervals,[100,100]);
 assert.equal(f.claims(),4);
 assert.equal(f.sends(),4);
 assert.equal(JSON.stringify(result).includes('intent'),false);
});

test('abort before first tick never claims; abort during wait never starts next tick',async()=>{
 const f=fixture(10),controller=new AbortController();
 controller.abort();
 await assert.rejects(runExternalNotificationPolling(f.database as never,
  f.provider,policy,controller.signal,async()=>{}),/abort/i);
 assert.equal(f.claims(),0);
 const another=new AbortController();
 await assert.rejects(runExternalNotificationPolling(f.database as never,
  f.provider,policy,another.signal,async()=>{
   another.abort();
  }),/abort/i);
 assert.equal(f.claims(),2);
 assert.equal(f.sends(),2);
});

test('invalid bounds or missing provider fail before invoking database or timer',async()=>{
 const f=fixture(100),sig=new AbortController().signal;
 let sleeps=0;
 const wait=async()=>{sleeps++;};
 for(const bad of [
  {...policy,maxTicks:0},{...policy,maxTicks:101},
  {...policy,maxTicks:1.5},{...policy,intervalMs:99},
  {...policy,intervalMs:60_001},{...policy,maxItemsPerTick:0},
  {...policy,maxItemsPerTick:26},
  {...policy,maxTicks:100,maxItemsPerTick:3},
  {...policy,leaseSeconds:29},{...policy,leaseSeconds:301},
 ]){
  await assert.rejects(runExternalNotificationPolling(f.database as never,
   f.provider,bad,sig,wait),RangeError);
 }
 await assert.rejects(runExternalNotificationPolling(f.database as never,
  {...f.provider,supportsIdempotentSend:false} as never,policy,sig,wait),
 /external_provider_idempotency_required/);
 assert.equal(f.claims(),0);
 assert.equal(sleeps,0);
});

test('transaction failures propagate rather than claiming successful sessions',async()=>{
 const f=fixture(1),sig=new AbortController().signal;
 const db={transaction:async()=>{throw new Error('uncertain COMMIT');}};
 await assert.rejects(runExternalNotificationPolling(db as never,
  f.provider,policy,sig,async()=>{}),/uncertain COMMIT/);
 assert.equal(f.sends(),0);
});
