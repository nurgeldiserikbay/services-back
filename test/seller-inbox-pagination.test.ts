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

test('seller inbox cursor uses UUID as tie-breaker for identical timestamps',async()=>{
 const sameTime=new Date('2026-11-09T12:00:00.000Z');
 const tied=['ffffffff-ffff-4fff-8fff-ffffffffffff',
   'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'];
 const tiedRows=tied.map(id=>({...rows[0],id,created_at:sameTime}));
 const db={query:async(_sql:string,params:unknown[])=>{
   const before=params[2] as string|null,beforeId=params[3] as string|null;
   return {rows:tiedRows.filter(row=>!before||row.created_at.toISOString()<before||
     (row.created_at.toISOString()===before&&row.id<beforeId!))
     .slice(0,params[4] as number)};
 }};
 const first=await readSellerInbox(db as never,userId,parseSellerInboxFilter({limit:'1'}));
 assert.equal(first.items[0].id,tied[0]);
 assert.ok(first.next_cursor);
 const second=await readSellerInbox(db as never,userId,
   parseSellerInboxFilter({limit:'1',cursor:first.next_cursor!}));
 assert.equal(second.items[0].id,tied[1]);
 assert.equal(second.next_cursor,null);
});

test('SQL cursor comparison and ordering use the same millisecond precision',async()=>{
 let sql='';
 const db={query:async(query:string)=>{sql=query;return {rows:[]};}};
 await readSellerInbox(db as never,userId,parseSellerInboxFilter({limit:'1'}));
 assert.match(sql,/date_trunc\('milliseconds',req\.created_at\),req\.id\)</);
 assert.match(sql,/ORDER BY date_trunc\('milliseconds',req\.created_at\) DESC,req\.id DESC/);
});

test('repository rejects invalid internal pagination filters before SQL',async()=>{
 let calls=0;
 const db={query:async()=>{calls++;return {rows:[]};}};
 const valid=parseSellerInboxFilter({limit:'1'});
 for(const invalid of [
   null,undefined,{...valid,before:undefined},
   {...valid,limit:0},{...valid,limit:51},{...valid,limit:1.5},
   {...valid,state:'unauthorized'},
   {...valid,state:undefined},{...valid,state:42},
   {...valid,before:{id:42,createdAt:'2026-11-09T12:00:00.000Z'}},
   {...valid,before:{id:randomUUID(),createdAt:42}},
   {...valid,before:{id:randomUUID(),createdAt:'not-a-date'}},
   {...valid,before:{id:'invalid',createdAt:'2026-11-09T12:00:00.000Z'}},
 ]){
   await assert.rejects(readSellerInbox(db as never,userId,invalid as never),
     /invalid_seller_inbox_filter/);
 }
 assert.equal(calls,0);
});

test('repository accepts a valid cursor on the second page',async()=>{
 let calls=0;
 const db={query:async()=>{calls++;return {rows:[]};}};
 const filter=parseSellerInboxFilter({limit:'1',cursor:Buffer.from(
   JSON.stringify(['2026-11-09T12:00:00.000Z',randomUUID()]),'utf8').toString('base64url')});
 await assert.doesNotReject(readSellerInbox(db as never,userId,filter));
 assert.equal(calls,1);
});
