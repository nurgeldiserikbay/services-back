import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {processExternalNotificationBatch}
 from '../src/modules/notifications/external-delivery-batch.js';

function fixture(items:number,verdict:'ACCEPTED'|'UNKNOWN'='ACCEPTED'){
 const log:string[]=[];
 let claimed=0,inTransaction=false;
 let providerCalls=0;
 const database={
  transaction:async<T>(fn:(client:never)=>Promise<T>):Promise<T>=>{
   assert.equal(inTransaction,false);
   inTransaction=true;
   log.push('BEGIN');
   try{
    const result=await fn({
     query:async(sql:string)=>{
      if(sql.includes('WITH candidate AS')){
       log.push('CLAIM');
       if(claimed>=items)return {rows:[]};
       claimed++;
       return {rows:[{
        id:randomUUID(),intent_id:randomUUID(),channel:'EMAIL',
        lease_expires_at:new Date(Date.now()+90000),
       }]};
      }
      if(sql.includes('SELECT d.intent_id::text')){
       log.push('LOCK');
       return {rows:[{intent_id:randomUUID(),channel:'EMAIL',
        attempt_count:0,intent_attempts:0}]};
      }
      if(sql.includes('UPDATE notification_deliveries')||
         sql.includes('UPDATE notification_intents')){
       log.push('UPDATE');
       return {rows:[{id:randomUUID()}]};
      }
      throw Error('unexpected SQL');
     },
    } as never);
    log.push('COMMIT');
    return result;
   }finally{
    inTransaction=false;
   }
  },
 };
 const provider={
  supportsIdempotentSend:true as const,
  reconcile:async()=>{
   assert.equal(inTransaction,false);
   log.push('RECONCILE');
   return verdict==='UNKNOWN'?'UNKNOWN' as const:'NOT_FOUND' as const;
  },
  send:async()=>{
   assert.equal(inTransaction,false);
   providerCalls++;
   log.push('SEND');
   return 'ACCEPTED' as const;
  },
 };
 return {database,provider,log,claims:()=>claimed,sends:()=>providerCalls};
}

test('bounded batch stops at NO_WORK and returns count-only summary',async()=>{
 const f=fixture(2);
 const result=await processExternalNotificationBatch(
  f.database as never,f.provider,5);
 assert.deepEqual(result,{
  examined:2,exhausted:true,sent:2,retryScheduled:0,
  failed:0,deferred:0,leaseLost:0,
 });
 assert.equal(f.sends(),2);
 assert.equal(f.claims(),2);
 assert.equal(f.log.filter(x=>x==='CLAIM').length,3);
 assert.equal(f.log.filter(x=>x==='BEGIN').length,5);
 assert.equal(f.log.filter(x=>x==='COMMIT').length,5);
 assert.equal(JSON.stringify(result).includes('intent'),false);
});

test('batch enforces configured cap and never runs unbounded',async()=>{
 const f=fixture(100);
 const result=await processExternalNotificationBatch(
  f.database as never,f.provider,3);
 assert.equal(result.examined,3);
 assert.equal(result.exhausted,false);
 assert.equal(result.sent,3);
 assert.equal(f.claims(),3);
 assert.equal(f.sends(),3);
});

test('unknown provider reconciliations stay deferred without sending',async()=>{
 const f=fixture(2,'UNKNOWN');
 assert.deepEqual(await processExternalNotificationBatch(
  f.database as never,f.provider,5),{
  examined:2,exhausted:true,sent:0,retryScheduled:0,
  failed:0,deferred:2,leaseLost:0,
 });
 assert.equal(f.sends(),0);
});

test('invalid policy and unsupported provider reject before claiming',async()=>{
 const f=fixture(1);
 for(const n of [0,26,-1,1.2,NaN,Infinity]){
  await assert.rejects(processExternalNotificationBatch(
   f.database as never,f.provider,n),RangeError);
 }
 for(const n of [0,29,301,1.2]){
  await assert.rejects(processExternalNotificationBatch(
   f.database as never,f.provider,1,n),RangeError);
 }
 await assert.rejects(processExternalNotificationBatch(
  f.database as never,{...f.provider,supportsIdempotentSend:false} as never),
 /external_provider_idempotency_required/);
 assert.deepEqual(f.log,[]);
});

test('transaction failure propagates rather than presenting a healthy summary',async()=>{
 const db={transaction:async()=>{throw new Error('commit outcome unknown');}};
 const f=fixture(1);
 await assert.rejects(processExternalNotificationBatch(
  db as never,f.provider,1),/commit outcome unknown/);
 assert.equal(f.sends(),0);
});
