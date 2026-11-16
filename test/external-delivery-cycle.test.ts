import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {runExternalNotificationCycle}
 from '../src/modules/notifications/external-delivery-cycle.js';

function fixture(){
 const steps:string[]=[];
 let active=false,claims=0,sends=0;
 const intent=randomUUID(),delivery=randomUUID();
 const database={
  transaction:async<T>(fn:(client:never)=>Promise<T>):Promise<T>=>{
   assert.equal(active,false);
   active=true;
   steps.push('BEGIN');
   try{
    const result=await fn({query:async(sql:string)=>{
     if(sql.includes('FROM domain_outbox_events e')){
      steps.push('STAGE_EVENTS');
      return {rows:[{id:randomUUID()}]};
     }
     if(sql.includes('INSERT INTO notification_deliveries')){
      steps.push('STAGE_DELIVERIES');
      return {rows:[{id:delivery}]};
     }
     if(sql.includes('WITH candidate AS')){
      steps.push('CLAIM');
      claims++;
      return {rows:claims===1?[{
       id:delivery,intent_id:intent,channel:'EMAIL',
       lease_expires_at:new Date(Date.now()+90_000),
      }]:[]};
     }
     if(sql.includes('SELECT d.intent_id::text')){
      steps.push('ACK_SELECT');
      return {rows:[{intent_id:intent,channel:'EMAIL',
       attempt_count:0,intent_attempts:0,
       next_attempt_at:null,intent_next_attempt_at:null}]};
     }
     if(sql.includes('UPDATE notification_deliveries')||
        sql.includes('UPDATE notification_intents')){
      steps.push('ACK_UPDATE');
      return {rows:[{id:randomUUID()}]};
     }
     throw new Error('unexpected SQL');
    }} as never);
    steps.push('COMMIT');
    return result;
   }finally{
    active=false;
   }
  },
 };
 const provider={
  supportsIdempotentSend:true as const,
  reconcile:async()=>{
   assert.equal(active,false,'must not reconcile during transaction');
   steps.push('RECONCILE');
   return 'NOT_FOUND' as const;
  },
  send:async(x:{idempotencyKey:string})=>{
   assert.equal(active,false,'must not send during transaction');
   assert.equal(x.idempotencyKey,'EMAIL:'+intent);
   sends++;
   steps.push('SEND');
   return 'ACCEPTED' as const;
  },
 };
 return {database,provider,steps,claims:()=>claims,sends:()=>sends};
}

test('stages and commits durable outbox before any external provider I/O',async()=>{
 const f=fixture();
 const result=await runExternalNotificationCycle(
  f.database as never,f.provider,2,2);
 assert.deepEqual(result,{
  eventsVisited:1,deliveriesCreated:1,examined:1,exhausted:true,
  sent:1,retryScheduled:0,failed:0,deferred:0,leaseLost:0,
 });
 assert.deepEqual(f.steps.slice(0,4),
  ['BEGIN','STAGE_EVENTS','STAGE_DELIVERIES','COMMIT']);
 assert.ok(f.steps.indexOf('RECONCILE')>f.steps.indexOf('COMMIT'));
 assert.equal(f.sends(),1);
 assert.equal(JSON.stringify(result).includes('intentId'),false);
});

test('unsupported provider, invalid limits and pre-abort cause zero SQL',async()=>{
 const f=fixture();
 for(const args of [
  [0,1,90],[51,1,90],[1,0,90],[1,26,90],[1,1,29],[1,1,301],
 ] as const){
  await assert.rejects(runExternalNotificationCycle(
   f.database as never,f.provider,...args),RangeError);
 }
 await assert.rejects(runExternalNotificationCycle(
  f.database as never,
  {...f.provider,supportsIdempotentSend:false} as never),/external_provider_idempotency_required/);
 const controller=new AbortController();
 controller.abort();
 await assert.rejects(runExternalNotificationCycle(
  f.database as never,f.provider,25,10,90,controller.signal),/abort/i);
 assert.deepEqual(f.steps,[]);
});

test('staging COMMIT failure propagates and no provider is contacted',async()=>{
 const f=fixture();
 const database={transaction:async()=>{
  throw new Error('staging COMMIT unknown');
 }};
 await assert.rejects(runExternalNotificationCycle(
  database as never,f.provider),/staging COMMIT unknown/);
 assert.equal(f.sends(),0);
 assert.equal(f.steps.length,0);
});

test('abort after staging commit prevents claiming any delivery',async()=>{
 const f=fixture();
 const controller=new AbortController();
 const db={transaction:async<T>(fn:(client:never)=>Promise<T>):Promise<T>=>{
  const result=await f.database.transaction(fn);
  controller.abort();
  return result;
 }};
 await assert.rejects(runExternalNotificationCycle(
  db as never,f.provider,25,10,90,controller.signal),/abort/i);
 assert.deepEqual(f.steps.slice(0,4),
  ['BEGIN','STAGE_EVENTS','STAGE_DELIVERIES','COMMIT']);
 assert.equal(f.claims(),0);
 assert.equal(f.sends(),0);
});
