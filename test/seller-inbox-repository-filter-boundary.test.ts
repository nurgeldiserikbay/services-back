import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readSellerInbox} from '../src/modules/requests/seller-inbox.repository.js';

test('direct repository callers cannot omit normalized state or cursor fields',async()=>{
 const userId=randomUUID();
 let queries=0;
 const db={query:async()=>{queries++;return {rows:[]};}};
 const valid={limit:20,state:null,before:null};
 for(const filter of [
  {limit:20,before:null},
  {limit:20,state:null},
  {limit:20,state:undefined,before:null},
  {limit:20,state:null,before:undefined},
 ]){
  await assert.rejects(
   readSellerInbox(db as never,userId,filter as never),
   /invalid_seller_inbox_filter/,
  );
 }
 assert.equal(queries,0);
 const page=await readSellerInbox(db as never,userId,valid);
 assert.deepEqual(page,{items:[],next_cursor:null});
 assert.equal(queries,1);
});
