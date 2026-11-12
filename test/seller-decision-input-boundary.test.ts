import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {
  decideSellerRequest,SellerDecisionRejected,
} from '../src/modules/requests/seller-decision.transaction.js';

test('seller decisions reject malformed identities and versions without SQL',async()=>{
 let calls=0;
 const db={query:async()=>{calls++;throw new Error('unexpected SQL');}};
 const requestId=randomUUID(),sellerId=randomUUID();
 const seller={kind:'professional',sellerId} as const;
 const cases: Array<[unknown,unknown,unknown,unknown]>=[
  [null,seller,'accept',1],
  [requestId,null,'accept',1],
  [requestId,undefined,'accept',1],
  [requestId,{kind:'professional'},'accept',1],
  [requestId,{kind:'professional',sellerId:null},'accept',1],
  [requestId,{kind:'organization',sellerId:'bad'},'accept',1],
  [requestId,{kind:'auditor',sellerId},'accept',1],
  [requestId,seller,'approve',1],
  [requestId,seller,'accept',0],
  [requestId,seller,'accept',1.5],
  [requestId,seller,'accept',Number.MAX_SAFE_INTEGER+1],
 ];
 for(const [id,actor,decision,version] of cases){
  await assert.rejects(
   decideSellerRequest(db as never,id as string,actor as never,
    decision as never,version as number),
   (error:unknown)=>error instanceof SellerDecisionRejected&&error.reason==='not_found',
  );
 }
 assert.equal(calls,0);
});

test('seller decisions reject foreign ownership and stale versions before mutation',async()=>{
 const requestId=randomUUID(),sellerId=randomUUID(),otherId=randomUUID();
 const row={
  id:requestId,status:'PENDING',version:2,
  seller_professional_id:sellerId,seller_organization_id:null,
  customer_person_id:randomUUID(),guest_contact_id:null,
 };
 for(const scenario of [
  {seller:{kind:'professional',sellerId:otherId},version:2,reason:'forbidden'},
  {seller:{kind:'organization',sellerId},version:2,reason:'forbidden'},
  {seller:{kind:'professional',sellerId},version:1,reason:'conflict'},
  {seller:{kind:'professional',sellerId},version:3,reason:'conflict'},
 ] as const){
  let queries=0;
  const db={query:async()=>{queries++;return {rows:[row]};}};
  await assert.rejects(decideSellerRequest(db as never,requestId,
   scenario.seller,'accept',scenario.version),
   (error:unknown)=>error instanceof SellerDecisionRejected&&
    error.reason===scenario.reason);
  assert.equal(queries,1,'must not mutate or enqueue notifications');
 }
});

test('seller decisions reject already decided requests without event emission',async()=>{
 const requestId=randomUUID(),sellerId=randomUUID();
 for(const status of ['ACCEPTED','DECLINED','CANCELLED_BY_CUSTOMER']){
  let queries=0;
  const db={query:async()=>{queries++;return {rows:[{
   id:requestId,status,version:2,seller_professional_id:sellerId,
   seller_organization_id:null,customer_person_id:randomUUID(),guest_contact_id:null,
  }]};}};
  await assert.rejects(decideSellerRequest(db as never,requestId,
   {kind:'professional',sellerId},'decline',2),
   (error:unknown)=>error instanceof SellerDecisionRejected&&error.reason==='conflict');
  assert.equal(queries,1);
 }
});

test('guest decision requires a verified non-expired contact before mutation',async()=>{
 const requestId=randomUUID(),sellerId=randomUUID(),guestId=randomUUID();
 for(const contact of [undefined,{channel:'push'},{channel:null}]){
  const statements:string[]=[];
  const db={query:async(sql:string)=>{
   statements.push(sql);
   if(statements.length===1)return {rows:[{
    id:requestId,status:'PENDING',version:1,
    seller_professional_id:sellerId,seller_organization_id:null,
    customer_person_id:null,guest_contact_id:guestId,
   }]};
   if(statements.length===2)return {rows:contact?[contact]:[]};
   throw new Error('unexpected mutation or notification write');
  }};
  await assert.rejects(decideSellerRequest(db as never,requestId,
   {kind:'professional',sellerId},'accept',1),
   (error:unknown)=>error instanceof SellerDecisionRejected&&error.reason==='conflict');
  assert.equal(statements.length,2);
  assert.ok(statements[1].includes('verified_at IS NOT NULL'));
  assert.ok(statements[1].includes('expires_at>now()'));
 }
});

test('accepted registered request writes exactly one transition, event, outbox and notification intent',async()=>{
 const requestId=randomUUID(),sellerId=randomUUID(),customerId=randomUUID();
 const statements:string[]=[];
 const db={query:async(sql:string,params?:unknown[])=>{
  statements.push(sql);
  if(sql.includes('FROM service_requests WHERE'))return {rows:[{
   id:requestId,status:'PENDING',version:1,
   seller_professional_id:sellerId,seller_organization_id:null,
   customer_person_id:customerId,guest_contact_id:null,
  }]};
  if(sql.includes('UPDATE service_requests')){
   assert.deepEqual(params,[requestId,'ACCEPTED',1]);
   return {rows:[{version:2}]};
  }
  if(sql.includes('INSERT INTO'))return {rows:[]};
  throw new Error('unexpected SQL');
 }};
 const result=await decideSellerRequest(db as never,requestId,
  {kind:'professional',sellerId},'accept',1);
 assert.deepEqual(result,{id:requestId,state:'accepted',version:2,replayed:false});
 assert.equal(statements.filter(sql=>sql.includes('UPDATE service_requests')).length,1);
 assert.equal(statements.filter(sql=>sql.includes('INSERT INTO service_request_events')).length,1);
 assert.equal(statements.filter(sql=>sql.includes('INSERT INTO domain_outbox_events')).length,1);
 assert.equal(statements.filter(sql=>sql.includes('INSERT INTO notification_intents')).length,1);
 assert.equal(statements.length,5);
});

test('guest decline writes a verified-channel notification without exposing contact',async()=>{
 const requestId=randomUUID(),sellerId=randomUUID(),guestId=randomUUID();
 const statements:Array<{sql:string;params:unknown[]}>=[];
 const db={query:async(sql:string,params:unknown[]=[])=>{
  statements.push({sql,params});
  if(sql.includes('FROM service_requests WHERE'))return {rows:[{
   id:requestId,status:'PENDING',version:4,
   seller_professional_id:sellerId,seller_organization_id:null,
   customer_person_id:null,guest_contact_id:guestId,
  }]};
  if(sql.includes('FROM guest_contacts'))return {rows:[{channel:'email'}]};
  if(sql.includes('UPDATE service_requests'))return {rows:[{version:5}]};
  if(sql.includes('INSERT INTO'))return {rows:[]};
  throw new Error('unexpected SQL');
 }};
 const result=await decideSellerRequest(db as never,requestId,
  {kind:'professional',sellerId},'decline',4);
 assert.deepEqual(result,{id:requestId,state:'declined',version:5,replayed:false});
 const notification=statements.filter(item=>item.sql.includes('INSERT INTO notification_intents'));
 assert.equal(notification.length,1);
 assert.equal(notification[0].params[2],guestId);
 assert.equal(notification[0].params[3],'EMAIL');
 assert.equal(statements.filter(item=>item.sql.includes('INSERT INTO domain_outbox_events')).length,1);
 assert.equal(statements.length,6);
});

test('failed optimistic update never emits an outbox event or notification',async()=>{
 const requestId=randomUUID(),sellerId=randomUUID(),customerId=randomUUID();
 const statements:string[]=[];
 const db={query:async(sql:string)=>{
  statements.push(sql);
  if(sql.includes('FROM service_requests WHERE'))return {rows:[{
   id:requestId,status:'PENDING',version:1,
   seller_professional_id:sellerId,seller_organization_id:null,
   customer_person_id:customerId,guest_contact_id:null,
  }]};
  if(sql.includes('UPDATE service_requests'))return {rows:[]};
  throw new Error('unexpected outbox or notification write');
 }};
 await assert.rejects(decideSellerRequest(db as never,requestId,
  {kind:'professional',sellerId},'accept',1),
  (error:unknown)=>error instanceof SellerDecisionRejected&&error.reason==='conflict');
 assert.equal(statements.length,2);
 assert.ok(!statements.some(sql=>sql.includes('INSERT INTO')));
});
