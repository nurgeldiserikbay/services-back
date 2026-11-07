import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readSellerInbox} from '../src/modules/requests/seller-inbox.repository.js';

const account='11111111-1111-4111-8111-111111111111';
const row={
 id:'22222222-2222-4222-8222-222222222222',
 service_offer_id:'33333333-3333-4333-8333-333333333333',
 seller_id:'44444444-4444-4444-8444-444444444444',
 title:'Example service',status:'PENDING',version:1,
 seller_kind:'professional' as const,
 created_at:new Date('2026-11-07T10:00:00.000Z'),scheduled_start_at:null,
};
const filter={limit:20,state:null,before:null};
function client(rows:unknown[]){
 return {query:async()=>({rows})} as Parameters<typeof readSellerInbox>[0];
}
test('seller inbox returns only a narrow public-safe DTO',async()=>{
 const page=await readSellerInbox(client([row]),account,filter);
 assert.deepEqual(page,{items:[{
  id:row.id,service_offer_id:row.service_offer_id,seller_id:row.seller_id,
  title:row.title,state:'pending',version:1,seller_kind:'professional',
  created_at:'2026-11-07T10:00:00.000Z',scheduled_start_at:null,
 }],next_cursor:null});
});
test('seller inbox rejects malformed database records',async()=>{
 for(const changed of [
  {id:'bad'}, {service_offer_id:'bad'}, {seller_id:'bad'},
  {title:'x'.repeat(501)}, {title:null}, {seller_kind:'invalid'},
  {status:'UNKNOWN'}, {version:0}, {created_at:new Date(NaN)},
 ]){
  await assert.rejects(readSellerInbox(client([{...row,...changed}]),account,filter),
    /invalid_seller_inbox_row/);
 }
});
test('seller inbox rejects invalid authenticated user ID before SQL',async()=>{
 let called=false;
 await assert.rejects(readSellerInbox({
  query:async()=>{called=true;return {rows:[]};},
 } as Parameters<typeof readSellerInbox>[0],'not-an-id',filter),/invalid_identity/);
 assert.equal(called,false);
});

test('seller inbox rejects duplicate request IDs from database',async()=>{
 await assert.rejects(readSellerInbox(client([row,{...row,title:'duplicate'}]),account,filter),
   /invalid_seller_inbox_row/);
});
