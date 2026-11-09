import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readSellerInbox} from '../src/modules/requests/seller-inbox.repository.js';
import {parseSellerInboxFilter} from '../src/modules/requests/seller-inbox.contract.js';

const userId=randomUUID(),offerId=randomUUID(),sellerId=randomUUID();
const ids=[randomUUID(),randomUUID(),randomUUID()];
const times=['2026-11-09T12:03:00.000Z','2026-11-09T12:02:00.000Z','2026-11-09T12:01:00.000Z'];
const rows=ids.map((id,i)=>({id,service_offer_id:offerId,title:'Service',
 status:'PENDING',version:1,seller_kind:'professional' as const,seller_id:sellerId,
 created_at:new Date(times[i]),scheduled_start_at:null}));

test('seller inbox cursor walks all rows without skipping or repeating entries',async()=>{
 const db={query:async(_sql:string,params:unknown[])=>{
   const before=params[2] as string|null;
   const beforeId=params[3] as string|null;
   const limit=params[4] as number;
   return {rows:rows.filter(row=>!before||row.created_at.toISOString()<before||
     (row.created_at.toISOString()===before&&row.id<beforeId!)).slice(0,limit)};
 }};
 let cursor:string|undefined;
 const seen:string[]=[];
 for(let i=0;i<4;i++){
   const page=await readSellerInbox(db as never,userId,
     parseSellerInboxFilter({limit:'1',...(cursor?{cursor}:{})}));
   seen.push(...page.items.map(item=>item.id));
   if(page.next_cursor===null)break;
   cursor=page.next_cursor;
 }
 assert.deepEqual(seen,ids);
 assert.equal(new Set(seen).size,ids.length);
});

test('seller inbox does not expose private request notes or guest contact fields',async()=>{
 const db={query:async()=>({rows:[rows[0]]})};
 const page=await readSellerInbox(db as never,userId,parseSellerInboxFilter({limit:'1'}));
 assert.deepEqual(Object.keys(page.items[0]).sort(),[
   'created_at','id','scheduled_start_at','seller_id','seller_kind',
   'service_offer_id','state','title','version',
 ].sort());
 assert.equal(page.next_cursor,null);
});
