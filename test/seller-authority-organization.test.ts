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
