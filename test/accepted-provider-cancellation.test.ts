import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
  validateReviewedProviderReliability,AcceptedProviderCancellationRejected,
  cancelAcceptedByVerifiedProviderOwner,
} from '../src/modules/requests/accepted-provider-cancellation.transaction.js';

const id='11111111-1111-4111-8111-111111111111';
const person='22222222-2222-4222-8222-222222222222';
const policy={formulaVersion:'reviewed_v1',approvalId:'APPROVAL-2026-001',
  providerWeight:'0.50'};

test('no provider reliability formula default or unapproved weight',()=>{
  assert.deepEqual(validateReviewedProviderReliability(policy),policy);
  for(const v of [null,{},[],{...policy,providerWeight:'0'},
    {...policy,providerWeight:'-1'},{...policy,providerWeight:'100'},
    {...policy,providerWeight:'1.234'},
    {...policy,approvalId:'invalid'}, {...policy,other:'x'}]){
    assert.throws(()=>validateReviewedProviderReliability(v),
      AcceptedProviderCancellationRejected);
  }
});
test('invalid input and missing policy do not touch the database',async()=>{
  const db={query:async()=>{throw Error('db touched');}};
  for(const [r,p,v] of [['invalid',person,1],[id,'bad',1],[id,person,0]] as const){
    await assert.rejects(cancelAcceptedByVerifiedProviderOwner(db as never,
      r,p,v,policy),AcceptedProviderCancellationRejected);
  }
  await assert.rejects(cancelAcceptedByVerifiedProviderOwner(db as never,
    id,person,1,null as never),AcceptedProviderCancellationRejected);
});
test('terminal or stale requests fail before any cancellation write',async()=>{
  const statements:string[]=[];
  const db={query:async(sql:string)=>{
    statements.push(sql);
    return {rows:[{status:'COMPLETED',version:2}]};
  }};
  await assert.rejects(cancelAcceptedByVerifiedProviderOwner(db as never,
    id,person,1,policy),AcceptedProviderCancellationRejected);
  assert.equal(statements.length,1);
});

const professional='33333333-3333-4333-8333-333333333333';
const customer='44444444-4444-4444-8444-444444444444';
const accepted=new Date('2026-11-01T12:00:00.000Z');
const start=new Date('2026-11-08T12:00:00.000Z');
const end=new Date('2026-11-08T13:00:00.000Z');
const deadline=new Date('2026-11-08T10:00:00.000Z');

/** SQL-aware fake verifies the write order without claiming DB integration. */
function successfulProfessionalTransaction(){
  const calls:Array<{sql:string;params:unknown[]|undefined}>=[];
  const db={query:async (sql:string,params?:unknown[])=>{
    calls.push({sql,params});
    if(sql.includes('FROM service_requests'))return {rows:[{
      status:'ACCEPTED',version:1,customer_person_id:customer,
      guest_contact_id:null,seller_professional_id:professional,
      seller_organization_id:null,scheduled_start_at:start,
      scheduled_end_at:end,accepted_at:accepted,timezone:'Asia/Almaty',
      customer_penalty_suspended:false,schedule_reconciliation_required:false,
    }]};
    if(sql.includes('FROM persons p'))return {rows:[{person_id:person}]};
    if(sql.includes('FROM professional_profiles'))return {rows:[
      {id:professional,person_id:person},
    ]};
    if(sql.includes('FROM cancellation_snapshots'))return {rows:[{
      scheduled_start_at:start,accepted_at:accepted,
      free_cancel_until:deadline,policy_revision:1,timezone:'Asia/Almaty',
    }]};
    if(sql.includes('FROM schedule_proposals'))return {rows:[{count:'0'}]};
    if(sql.includes('clock_timestamp()'))return {rows:[
      {now:new Date('2026-11-05T12:00:00.000Z')},
    ]};
    if(sql.includes('UPDATE service_requests'))return {rows:[{version:2}]};
    return {rows:[]};
  }};
  return {db,calls};
}

test('accepted professional cancellation persists two distinct IN_APP audiences and one PROPOSED event',async()=>{
  const {db,calls}=successfulProfessionalTransaction();
  const result=await cancelAcceptedByVerifiedProviderOwner(
    db as never,id,person,1,policy);
  assert.equal(result.state,'cancelled_by_provider');
  assert.equal(result.version,2);
  assert.equal(result.reliabilityProposed,true);
  assert.equal(calls.filter(c=>c.sql.includes('INSERT INTO notification_intents')).length,2);
  assert.deepEqual(calls.filter(c=>c.sql.includes('INSERT INTO notification_intents'))
    .map(c=>c.params?.[5]),['INITIATOR','COUNTERPARTY']);
  const rating=calls.filter(c=>c.sql.includes('INSERT INTO reliability_events'));
  assert.equal(rating.length,1);
  assert.equal(rating[0].params?.[2],'PROFESSIONAL');
  assert.equal(rating[0].params?.[3],professional);
  assert.equal(rating[0].params?.[5],policy.providerWeight);
  assert.equal(calls.filter(c=>c.sql.includes('DELETE FROM busy_blocks')).length,1);
  assert.equal(calls.filter(c=>c.sql.includes('INSERT INTO cancellation_events')).length,1);
  assert.equal(calls.filter(c=>c.sql.includes('INSERT INTO domain_outbox_events')).length,1);
});

test('pending schedule proposal rejects accepted cancellation without writes',async()=>{
  const {db,calls}=successfulProfessionalTransaction();
  const original=db.query;
  db.query=async(sql:string,params?:unknown[])=>
    sql.includes('FROM schedule_proposals')
      ? (calls.push({sql,params}),{rows:[{count:'1'}]})
      : original(sql,params);
  await assert.rejects(cancelAcceptedByVerifiedProviderOwner(
    db as never,id,person,1,policy),AcceptedProviderCancellationRejected);
  assert.equal(calls.some(c=>c.sql.includes('UPDATE service_requests')),false);
});

test('unmatched cancellation snapshot rejects before busy block changes',async()=>{
  const {db,calls}=successfulProfessionalTransaction();
  const original=db.query;
  db.query=async(sql:string,params?:unknown[])=>
    sql.includes('FROM cancellation_snapshots')
      ? (calls.push({sql,params}),{rows:[]}))
      : original(sql,params);
  await assert.rejects(cancelAcceptedByVerifiedProviderOwner(
    db as never,id,person,1,policy),AcceptedProviderCancellationRejected);
  assert.equal(calls.some(c=>c.sql.includes('DELETE FROM busy_blocks')),false);
});
