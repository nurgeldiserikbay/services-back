import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {reconcileAndSendClaimedExternalDelivery} from
 '../src/modules/notifications/external-provider-reconciliation.js';

function fixture(){
 const claim={
  deliveryId:randomUUID(),intentId:randomUUID(),leaseToken:randomUUID(),
  channel:'EMAIL' as const,leaseExpiresAt:new Date(Date.now()+60_000),
 };
 const statements:string[]=[];
 const database={
  transaction:async <T>(work:(client:never)=>Promise<T>):Promise<T>=>work({
   query:async(sql:string)=>{
    statements.push(sql);
    if(sql.includes('SELECT d.intent_id::text'))return {rows:[{
     intent_id:claim.intentId,channel:'EMAIL',attempt_count:0,intent_attempts:0,
    }]};
    if(sql.includes('UPDATE notification_deliveries'))return {rows:[{id:claim.deliveryId}]};
    if(sql.includes('UPDATE notification_intents'))return {rows:[{id:claim.intentId}]};
    throw new Error('unexpected SQL');
   },
  } as never),
 };
 return {claim,statements,database};
}

test('reconciliation finds accepted receipt and never issues another send',async()=>{
 const {claim,database,statements}=fixture();
 const calls:string[]=[];
 const provider={
  supportsIdempotentSend:true as const,
  reconcile:async(key:string)=>{calls.push('lookup:'+key);return 'ACCEPTED' as const;},
  send:async()=>{calls.push('send');return 'ACCEPTED' as const;},
 };
 const result=await reconcileAndSendClaimedExternalDelivery(database as never,provider,claim);
 assert.equal(result,'SENT');
 assert.deepEqual(calls,['lookup:EMAIL:'+claim.intentId]);
 assert.equal(statements.filter(x=>/^\s*UPDATE\b/.test(x)).length,2);
});

test('fresh send only follows conclusive NOT_FOUND with a stable idempotency key',async()=>{
 const {claim,database}=fixture();
 const keys:string[]=[];
 const provider={
  supportsIdempotentSend:true as const,
  reconcile:async(key:string)=>{keys.push('lookup:'+key);return 'NOT_FOUND' as const;},
  send:async(x:{idempotencyKey:string;intentId:string;channel:string})=>{
   keys.push('send:'+x.idempotencyKey);
   assert.equal(x.intentId,claim.intentId);
   assert.equal(x.channel,'EMAIL');
   return 'ACCEPTED' as const;
  },
 };
 assert.equal(await reconcileAndSendClaimedExternalDelivery(database as never,provider,claim),'SENT');
 assert.deepEqual(keys,['lookup:EMAIL:'+claim.intentId,'send:EMAIL:'+claim.intentId]);
});

test('unknown reconciliation and provider network errors defer without SQL or unsafe resend',async()=>{
 const {claim,database,statements}=fixture();
 let sends=0;
 const send=async()=>{sends++;return 'UNKNOWN' as const;};
 for(const reconcile of [
  async()=> 'UNKNOWN' as const,
  async()=>{throw Error('sensitive provider detail');},
 ]){
  const result=await reconcileAndSendClaimedExternalDelivery(database as never,{
   supportsIdempotentSend:true,reconcile,send,
  },claim);
  assert.equal(result,'DEFERRED');
 }
 assert.equal(sends,0);
 for(const sendFailure of [
  async()=> 'UNKNOWN' as const,
  async():Promise<'ACCEPTED'>=>{throw Error('response acknowledgement lost');},
 ]){
  assert.equal(await reconcileAndSendClaimedExternalDelivery(database as never,{
   supportsIdempotentSend:true,reconcile:async()=> 'NOT_FOUND',send:sendFailure,
  },claim),'DEFERRED');
 }
 assert.equal(statements.length,0);
});

test('definitive provider rejection delegates retry decision, stale fencing never overwrites',async()=>{
 const {claim,statements}=fixture();
 const db={transaction:async<T>(work:(client:never)=>Promise<T>):Promise<T>=>work({
  query:async(sql:string)=>{
   statements.push(sql);
   // Failed or stolen lease: claim proof does not match.
   return {rows:[]};
  },
 } as never)};
 const result=await reconcileAndSendClaimedExternalDelivery(db as never,{
  supportsIdempotentSend:true,
  reconcile:async()=> 'NOT_FOUND',
  send:async()=> 'REJECTED',
 },claim);
 assert.equal(result,'LEASE_LOST');
 assert.equal(statements.length,1);
 assert.match(statements[0],/lease_token/);
});

test('expired delivery lease never consults provider or changes SQL',async()=>{
 const {claim,database,statements}=fixture();
 const calls:string[]=[];
 const provider={
  supportsIdempotentSend:true as const,
  reconcile:async()=>{calls.push('lookup');return 'NOT_FOUND' as const;},
  send:async()=>{calls.push('send');return 'ACCEPTED' as const;},
 };
 const expired={...claim,leaseExpiresAt:new Date(Date.now()-1000)};
 assert.equal(await reconcileAndSendClaimedExternalDelivery(
  database as never,provider,expired),'LEASE_LOST');
 assert.deepEqual(calls,[]);
 assert.deepEqual(statements,[]);
});

test('lease expiring during reconciliation cannot start a provider send',async()=>{
 const {claim,database,statements}=fixture();
 const calls:string[]=[];
 // First lease check passes; the second is after expiration.
 const earlier=new Date(claim.leaseExpiresAt.getTime()-1000);
 const later=new Date(claim.leaseExpiresAt.getTime()+1000);
 let checks=0;
 const outcome=await reconcileAndSendClaimedExternalDelivery(
  database as never,{
   supportsIdempotentSend:true,
   reconcile:async()=>{calls.push('lookup');return 'NOT_FOUND';},
   send:async()=>{calls.push('send');return 'ACCEPTED';},
  },claim,()=>++checks===1?earlier:later);
 assert.equal(outcome,'LEASE_LOST');
 assert.deepEqual(calls,['lookup']);
 assert.deepEqual(statements,[]);
});

test('unsupported provider cannot send or access database',async()=>{
 const {claim,database,statements}=fixture();
 let sends=0;
 const provider={
  supportsIdempotentSend:false,
  reconcile:async()=> 'NOT_FOUND' as const,
  send:async()=>{sends++;return 'ACCEPTED' as const;},
 };
 await assert.rejects(
  reconcileAndSendClaimedExternalDelivery(database as never,provider as never,claim),
  /external_provider_idempotency_required/);
 assert.equal(sends,0);
 assert.equal(statements.length,0);
});
