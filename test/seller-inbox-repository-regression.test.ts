import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {PoolClient} from 'pg';
import {readSellerInbox} from '../src/modules/requests/seller-inbox.repository.js';
import {encodeInboxCursor,parseSellerInboxFilter} from '../src/modules/requests/seller-inbox.contract.js';

const userId='11111111-1111-4111-8111-111111111111';
const requestId='22222222-2222-4222-8222-222222222222';
const offerId='33333333-3333-4333-8333-333333333333';
const sellerId='44444444-4444-4444-8444-444444444444';

test('seller inbox queries only authenticated ownership and bounded rows',async()=>{
  let sql='';let args:unknown[]=[];
  const client={query:async(statement:string,parameters:unknown[])=>{
    sql=statement;args=parameters;return {rows:[]};
  }} as unknown as Pick<PoolClient,'query'>;
  const result=await readSellerInbox(client,userId,parseSellerInboxFilter({limit:'20',state:'pending'}));
  assert.deepEqual(result,{items:[],next_cursor:null});
  assert.equal(args[0],userId);
  assert.equal(args[1],'pending');
  assert.equal(args[4],21);
  assert.match(sql,/usr\.id=\$1::uuid/);
  assert.match(sql,/\(req\.seller_professional_id IS NULL\) <> \(req\.seller_organization_id IS NULL\)/);
  assert.match(sql,/member\.role IN \('OWNER','ADMIN'\)/);
  assert.match(sql,/member\.revoked_at IS NULL/);
  assert.match(sql,/ORDER BY date_trunc\('milliseconds',req\.created_at\) DESC,req\.id DESC/);
});

test('seller inbox returns cursor only when a following row exists',async()=>{
  const createdAt=new Date('2026-11-07T10:00:00.000Z');
  const row={id:requestId,service_offer_id:offerId,title:'Service',
    status:'PENDING',version:1,seller_kind:'professional',seller_id:sellerId,
    created_at:createdAt,scheduled_start_at:null};
  const client={query:async()=>({rows:[row,{...row,id:'55555555-5555-4555-8555-555555555555'}]})} as unknown as Pick<PoolClient,'query'>;
  const result=await readSellerInbox(client,userId,parseSellerInboxFilter({limit:'1'}));
  assert.equal(result.items.length,1);
  assert.equal(result.items[0].state,'pending');
  assert.equal(result.items[0].version,1);
  assert.ok(result.next_cursor);
  assert.deepEqual(parseSellerInboxFilter({cursor:result.next_cursor!}).before,{
    createdAt:createdAt.toISOString(),id:requestId,
  });
});

test('seller inbox rejects invalid authenticated user id before SQL',async()=>{
  let called=false;
  const client={query:async()=>{called=true;return {rows:[]}}} as unknown as Pick<PoolClient,'query'>;
  await assert.rejects(readSellerInbox(client,'not-a-uuid',parseSellerInboxFilter({})));
  assert.equal(called,false);
});

test('seller inbox rejects impossible dates and malformed cursor tuples',()=>{
  for(const cursor of [
    encodeInboxCursor('2026-02-30T10:00:00.000Z',requestId),
    encodeInboxCursor('2026-13-01T10:00:00.000Z',requestId),
    encodeInboxCursor('2026-11-07T10:00:00Z',requestId),
    encodeInboxCursor('2026-11-07T10:00:00.000Z','invalid'),
    'not-base64+',
  ]){
    assert.throws(()=>parseSellerInboxFilter({cursor}));
  }
});

test('seller inbox fails closed on unknown database status or invalid version',async()=>{
  const row={id:requestId,service_offer_id:offerId,title:'Service',
    status:'PENDING',version:1,seller_kind:'professional',seller_id:sellerId,
    created_at:new Date('2026-11-07T10:00:00.000Z'),scheduled_start_at:null};
  for(const bad of [
    {...row,status:'UNRECOGNIZED'},
    {...row,version:0},
    {...row,version:1.5},
    {...row,status:null},
    {...row,created_at:new Date('invalid')},
    {...row,scheduled_start_at:new Date('invalid')},
  ]){
    const client={query:async()=>({rows:[bad]})} as unknown as Pick<PoolClient,'query'>;
    await assert.rejects(readSellerInbox(client,userId,parseSellerInboxFilter({})),
      /invalid_seller_inbox_row/);
  }
});
