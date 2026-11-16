import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {processOneExternalNotification}
 from '../src/modules/notifications/external-delivery-worker.js';

function fixture(hasWork=true){
 const deliveryId=randomUUID(),intentId=randomUUID();
 const log:string[]=[];
 let insideTransaction=false,transactionCount=0;
 const database={
  transaction:async<T>(fn:(client:never)=>Promise<T>):Promise<T>=>{
   assert.equal(insideTransaction,false,'nested transaction');
   transactionCount++;
   insideTransaction=true;
   log.push('BEGIN');
   try{
    const result=await fn({
     query:async(sql:string,params:unknown[])=>{
      if(sql.includes('WITH candidate AS')){
       log.push('CLAIM');
       assert.equal(params.length,2);
       return {rows:hasWork?[{
        id:deliveryId,intent_id:intentId,channel:'EMAIL',
        lease_expires_at:new Date(Date.now()+90000),
       }]:[]};
      }
      if(sql.includes('SELECT d.intent_id::text')){
       log.push('ACK_LOCK');
       return {rows:[{
        intent_id:intentId,channel:'EMAIL',attempt_count:0,intent_attempts:0,next_attempt_at:null,intent_next_attempt_at:null,
       }]};
      }
      if(sql.includes('UPDATE notification_deliveries')){
       log.push('ACK_DELIVERY');
       return {rows:[{id:deliveryId}]};
      }
      if(sql.includes('UPDATE notification_intents')){
       log.push('ACK_INTENT');
       return {rows:[{id:intentId}]};
      }
      throw new Error('unexpected query');
     },
    } as never);
    log.push('COMMIT');
    return result;
   }finally{
    insideTransaction=false;
   }
  },
 };
 const provider={
  supportsIdempotentSend:true as const,
  reconcile:async(key:string,channel:'EMAIL'|'SMS')=>{
   assert.equal(insideTransaction,false,'provider reconciliation held database locks');
   assert.equal(key,'EMAIL:'+intentId);
   assert.equal(channel,'EMAIL');
   log.push('RECONCILE');
   return 'NOT_FOUND' as const;
  },
  send:async(item:{intentId:string;channel:'EMAIL'|'SMS';idempotencyKey:string})=>{
   assert.equal(insideTransaction,false,'provider send held database locks');
   assert.equal(item.intentId,intentId);
   assert.equal(item.idempotencyKey,'EMAIL:'+intentId);
   log.push('SEND');
   return 'ACCEPTED' as const;
  },
 };
 return {database,provider,log,transactions:()=>transactionCount};
}

test('worker commits claim before provider I/O and commits acknowledgement afterwards',async()=>{
 const {database,provider,log,transactions}=fixture();
 assert.equal(await processOneExternalNotification(database as never,provider),'SENT');
 assert.deepEqual(log,['BEGIN','CLAIM','COMMIT','RECONCILE','SEND',
  'BEGIN','ACK_LOCK','ACK_DELIVERY','ACK_INTENT','COMMIT']);
 assert.equal(transactions(),2);
});

test('empty queue commits claim only and never calls provider',async()=>{
 const {database,provider,log,transactions}=fixture(false);
 assert.equal(await processOneExternalNotification(database as never,provider),'NO_WORK');
 assert.deepEqual(log,['BEGIN','CLAIM','COMMIT']);
 assert.equal(transactions(),1);
});

test('unknown provider response is deferred without sending or acknowledging',async()=>{
 const {database,provider,log,transactions}=fixture();
 const unknown={...provider,reconcile:async()=>{
  log.push('RECONCILE');
  return 'UNKNOWN' as const;
 }};
 assert.equal(await processOneExternalNotification(database as never,unknown),
  'DEFERRED');
 assert.deepEqual(log,['BEGIN','CLAIM','COMMIT','RECONCILE']);
 assert.equal(transactions(),1);
});

test('missing idempotency guarantees and invalid lease fail before SQL',async()=>{
 const {database,provider,log}=fixture();
 await assert.rejects(processOneExternalNotification(database as never,
  {...provider,supportsIdempotentSend:false} as never),
  /external_provider_idempotency_required/);
 for(const length of [0,29,301,0.5,NaN]){
  await assert.rejects(processOneExternalNotification(
   database as never,provider,length),RangeError);
 }
 assert.deepEqual(log,[]);
});
