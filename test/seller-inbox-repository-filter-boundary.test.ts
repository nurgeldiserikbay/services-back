import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readSellerInbox} from '../src/modules/requests/seller-inbox.repository.js';
import {parseSellerInboxFilter} from '../src/modules/requests/seller-inbox.contract.js';

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
  {limit:0,state:null,before:null},
  {limit:51,state:null,before:null},
  {limit:20,state:'unknown',before:null},
  {limit:20,state:null,before:{createdAt:'2026-02-30T10:00:00.000Z',id:randomUUID()}},
  {limit:20,state:null,before:{createdAt:'2026-11-13T10:00:00.000Z',id:'not-a-uuid'}},
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


test('repository rejects malformed authenticated identity without querying PostgreSQL',async()=>{
 let queries=0;
 const db={query:async()=>{queries++;return {rows:[]};}};
 const filter={limit:20,state:null,before:null};
 for(const identity of [
  '', 'not-a-uuid', '00000000-0000-0000-0000-000000000000',
  '00000000-0000-0000-0000-000000000000;DROP TABLE users',
  null, undefined, 42, {},
 ]){
  await assert.rejects(
   readSellerInbox(db as never,identity as never,filter),
   /invalid_identity/,
  );
 }
 assert.equal(queries,0);
});

test('seller inbox parser returns 400 for malformed filter containers',()=>{
 for(const value of [null,undefined,[],42,'limit=20']){
  assert.throws(
   ()=>parseSellerInboxFilter(value as never),
   (error:unknown)=>Boolean(error&&typeof error==='object'&&
     'getStatus' in error&&typeof error.getStatus==='function'&&error.getStatus()===400),
  );
 }
});
