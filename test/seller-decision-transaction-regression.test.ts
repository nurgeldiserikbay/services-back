import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {PoolClient} from 'pg';
import {decideSellerRequest,SellerDecisionRejected} from '../src/modules/requests/seller-decision.transaction.js';

const requestId='11111111-1111-4111-8111-111111111111';
const sellerId='22222222-2222-4222-8222-222222222222';
const owner={kind:'professional' as const,sellerId};
const pending={id:requestId,status:'PENDING',version:1,seller_professional_id:sellerId,
  seller_organization_id:null,customer_person_id:'33333333-3333-4333-8333-333333333333',guest_contact_id:null};

test('seller cannot decide request belonging to another seller',async()=>{
  const statements:string[]=[];
  const client={query:async(sql:string)=>{
    statements.push(sql);
    return {rows:[{...pending,seller_professional_id:'44444444-4444-4444-8444-444444444444'}]};
  }} as unknown as Pick<PoolClient,'query'>;
  await assert.rejects(decideSellerRequest(client,requestId,owner,'accept',1),
    (error:unknown)=>error instanceof SellerDecisionRejected&&error.reason==='forbidden');
  assert.equal(statements.length,1);
});

test('stale version cannot create events or notifications',async()=>{
  const statements:string[]=[];
  const client={query:async(sql:string)=>{
    statements.push(sql);
    return {rows:[pending]};
  }} as unknown as Pick<PoolClient,'query'>;
  await assert.rejects(decideSellerRequest(client,requestId,owner,'accept',2),
    (error:unknown)=>error instanceof SellerDecisionRejected&&error.reason==='conflict');
  assert.equal(statements.length,1);
});

test('successful acceptance writes event and notification intent',async()=>{
  const statements:string[]=[];
  const client={query:async(sql:string)=>{
    statements.push(sql);
    if(sql.includes('FROM service_requests WHERE'))return {rows:[pending]};
    if(sql.includes('UPDATE service_requests'))return {rows:[{version:2}]};
    return {rows:[]};
  }} as unknown as Pick<PoolClient,'query'>;
  const result=await decideSellerRequest(client,requestId,owner,'accept',1);
  assert.deepEqual(result,{id:requestId,state:'accepted',version:2,replayed:false});
  assert.ok(statements.some(sql=>sql.includes('INSERT INTO service_request_events')));
  assert.ok(statements.some(sql=>sql.includes('INSERT INTO domain_outbox_events')));
  assert.ok(statements.some(sql=>sql.includes('INSERT INTO notification_intents')));
  assert.ok(!statements.some(sql=>sql.includes('INSERT INTO calendar')));
});
