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

test('already accepted request cannot be replayed without matching ledger key',async()=>{
  const statements:string[]=[];
  const client={query:async(sql:string)=>{
    statements.push(sql);
    return {rows:[{...pending,status:'ACCEPTED',version:2}]};
  }} as unknown as Pick<PoolClient,'query'>;
  await assert.rejects(decideSellerRequest(client,requestId,owner,'accept',1),
    (error:unknown)=>error instanceof SellerDecisionRejected&&error.reason==='conflict');
  assert.equal(statements.length,1);
});

test('already declined request cannot be replayed without matching ledger key',async()=>{
  const statements:string[]=[];
  const client={query:async(sql:string)=>{
    statements.push(sql);
    return {rows:[{...pending,status:'DECLINED',version:2}]};
  }} as unknown as Pick<PoolClient,'query'>;
  await assert.rejects(decideSellerRequest(client,requestId,owner,'decline',1),
    (error:unknown)=>error instanceof SellerDecisionRejected&&error.reason==='conflict');
  assert.equal(statements.length,1);
});

test('guest decision requires verified, unexpired notification contact',async()=>{
  const statements:string[]=[];
  const guest={...pending,customer_person_id:null,
    guest_contact_id:'66666666-6666-4666-8666-666666666666'};
  const client={query:async(sql:string)=>{
    statements.push(sql);
    if(sql.includes('FROM service_requests WHERE'))return {rows:[guest]};
    if(sql.includes('UPDATE service_requests'))return {rows:[{version:2}]};
    if(sql.includes('FROM guest_contacts'))return {rows:[]};
    return {rows:[]};
  }} as unknown as Pick<PoolClient,'query'>;
  await assert.rejects(decideSellerRequest(client,requestId,owner,'decline',1),
    (error:unknown)=>error instanceof SellerDecisionRejected&&error.reason==='conflict');
  assert.ok(statements.some(sql=>sql.includes('verified_at IS NOT NULL AND expires_at>now()')&&sql.includes('FOR SHARE')));
  assert.ok(!statements.some(sql=>sql.includes('INSERT INTO notification_intents')));
  assert.ok(!statements.some(sql=>sql.includes('UPDATE service_requests')));
  assert.ok(!statements.some(sql=>sql.includes('INSERT INTO domain_outbox_events')));
  // Caller must roll back the enclosing transaction on this rejection.
});

test('verified guest receives a channel-specific notification intent',async()=>{
  const statements:{sql:string;params:unknown[]}[]=[];
  const guest={...pending,customer_person_id:null,
    guest_contact_id:'66666666-6666-4666-8666-666666666666'};
  const client={query:async(sql:string,params:unknown[]=[])=>{
    statements.push({sql,params});
    if(sql.includes('FROM service_requests WHERE'))return {rows:[guest]};
    if(sql.includes('UPDATE service_requests'))return {rows:[{version:2}]};
    if(sql.includes('FROM guest_contacts'))return {rows:[{channel:'sms'}]};
    return {rows:[]};
  }} as unknown as Pick<PoolClient,'query'>;
  const result=await decideSellerRequest(client,requestId,owner,'decline',1);
  assert.equal(result.state,'declined');
  const intent=statements.find(x=>x.sql.includes('INSERT INTO notification_intents'));
  assert.ok(intent);
  assert.equal(intent.params[3],'SMS');
});

test('guest verification precedes mutation and outbox writes',async()=>{
  const statements:string[]=[];
  const guest={...pending,customer_person_id:null,
    guest_contact_id:'66666666-6666-4666-8666-666666666666'};
  const client={query:async(sql:string)=>{
    statements.push(sql);
    if(sql.includes('FROM service_requests WHERE'))return {rows:[guest]};
    if(sql.includes('FROM guest_contacts'))return {rows:[{channel:'email'}]};
    if(sql.includes('UPDATE service_requests'))return {rows:[{version:2}]};
    return {rows:[]};
  }} as unknown as Pick<PoolClient,'query'>;
  const result=await decideSellerRequest(client,requestId,owner,'accept',1);
  assert.equal(result.state,'accepted');
  const verified=statements.findIndex(sql=>sql.includes('FROM guest_contacts'));
  const updated=statements.findIndex(sql=>sql.includes('UPDATE service_requests'));
  assert.ok(verified>=0&&updated>verified);
  assert.match(statements[verified],/FOR SHARE/);
});
