import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {resolveSellerDecisionAuthority} from '../src/modules/requests/seller-authority.js';

test('organization seller authority uses authenticated user and locked request context',async()=>{
 const userId=randomUUID(),requestId=randomUUID(),orgId=randomUUID();
 const queries:Array<{sql:string;params:unknown[]}>=[];
 const db={query:async(sql:string,params:unknown[])=>{
   queries.push({sql,params});
   if(queries.length===1)return {rows:[{professional_id:null,organization_id:orgId}]};
   return {rows:[{allowed:true}]};
 }};
 assert.deepEqual(await resolveSellerDecisionAuthority(db as never,userId,requestId),{
   authorized:true,seller:{kind:'organization',sellerId:orgId},
 });
 assert.match(queries[0].sql,/FOR UPDATE/);
 assert.deepEqual(queries[0].params,[requestId]);
 assert.match(queries[1].sql,/membership\.role IN \('OWNER','ADMIN'\)/);
 assert.match(queries[1].sql,/membership\.revoked_at IS NULL/);
 assert.deepEqual(queries[1].params,[orgId,userId]);
});

test('organization authority denies missing membership',async()=>{
 const userId=randomUUID(),requestId=randomUUID(),orgId=randomUUID();
 let count=0;
 const db={query:async()=>({rows:++count===1?
   [{professional_id:null,organization_id:orgId}]:[]})};
 assert.deepEqual(await resolveSellerDecisionAuthority(db as never,userId,requestId),
   {authorized:false});
});

test('ambiguous seller ownership fails closed without membership lookup',async()=>{
 const userId=randomUUID(),requestId=randomUUID();
 for(const row of [
   {professional_id:null,organization_id:null},
   {professional_id:randomUUID(),organization_id:randomUUID()},
 ]){
   let queries=0;
   const db={query:async()=>{queries++;return {rows:[row]};}};
   assert.deepEqual(await resolveSellerDecisionAuthority(db as never,userId,requestId),
     {authorized:false});
   assert.equal(queries,1);
 }
});

test('professional seller authority uses profile owner and denies unknown owner',async()=>{
 const userId=randomUUID(),requestId=randomUUID(),profileId=randomUUID();
 for(const allowed of [true,false]){
   const calls:Array<{sql:string;params:unknown[]}>=[];
   const db={query:async(sql:string,params:unknown[])=>{
     calls.push({sql,params});
     return calls.length===1
       ? {rows:[{professional_id:profileId,organization_id:null}]}
       : {rows:allowed?[{allowed:true}]:[]};
   }};
   const result=await resolveSellerDecisionAuthority(db as never,userId,requestId);
   assert.deepEqual(result,allowed
     ? {authorized:true,seller:{kind:'professional',sellerId:profileId}}
     : {authorized:false});
   assert.deepEqual(calls[1].params,[profileId,userId]);
   assert.match(calls[1].sql,/usr\.status='ACTIVE'/);
   assert.match(calls[1].sql,/prof\.status='PUBLISHED'/);
 }
});

test('missing request is denied without querying seller membership',async()=>{
 const userId=randomUUID(),requestId=randomUUID();
 let calls=0;
 const db={query:async()=>{calls++;return {rows:[]};}};
 assert.deepEqual(await resolveSellerDecisionAuthority(db as never,userId,requestId),
   {authorized:false});
 assert.equal(calls,1);
});

test('organization authority requires active organization, user, and unscoped owner membership',async()=>{
 const userId=randomUUID(),requestId=randomUUID(),orgId=randomUUID();
 const queries:string[]=[];
 const db={query:async(sql:string)=>{
   queries.push(sql);
   return queries.length===1
     ? {rows:[{professional_id:null,organization_id:orgId}]}
     : {rows:[]};
 }};
 assert.deepEqual(await resolveSellerDecisionAuthority(db as never,userId,requestId),
   {authorized:false});
 assert.match(queries[1],/org\.status='ACTIVE'/);
 assert.match(queries[1],/usr\.status='ACTIVE'/);
 assert.match(queries[1],/membership\.scope IS NULL OR membership\.scope='\{\}'::jsonb/);
 assert.match(queries[1],/FOR SHARE OF org, membership, usr/);
});

test('authorization never falls back to another seller when membership is denied',async()=>{
 const userId=randomUUID(),requestId=randomUUID(),orgId=randomUUID();
 let count=0;
 const db={query:async()=>({rows:++count===1
   ? [{professional_id:null,organization_id:orgId}]
   : []})};
 const result=await resolveSellerDecisionAuthority(db as never,userId,requestId);
 assert.deepEqual(result,{authorized:false});
 assert.equal(count,2);
});

test('malformed truthy database grants never authorize seller decisions',async()=>{
 const userId=randomUUID(),requestId=randomUUID(),sellerId=randomUUID();
 for(const kind of ['professional','organization'] as const){
   for(const malformed of ['true',1,{},null]){
     let calls=0;
     const db={query:async()=>{
       calls++;
       return calls===1?{rows:[{
         professional_id:kind==='professional'?sellerId:null,
         organization_id:kind==='organization'?sellerId:null,
       }]}:{rows:[{allowed:malformed}]};
     }};
     assert.deepEqual(await resolveSellerDecisionAuthority(db as never,userId,requestId),
       {authorized:false});
   }
 }
});
