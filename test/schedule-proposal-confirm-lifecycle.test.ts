import assert from 'node:assert/strict';
import test from 'node:test';
import {mutateScheduleProposal, ScheduleProposalRejected} from '../src/modules/requests/schedule-proposal.transaction.js';

const requestId='10000000-0000-4000-8000-000000000001';
const proposalId='10000000-0000-4000-8000-000000000002';
const guestId='10000000-0000-4000-8000-000000000003';
const pepper=Buffer.alloc(32,7);
const args={
  requestId,proposalId,action:'confirm' as const,expectedVersion:4,
  key:'confirm-guest-test',guestCapability:'A'.repeat(43),pepper,guestPepper:pepper,
};

function fakeDb(options:{initiator?:string;status?:string;start?:Date|null|string; end?:Date|null|string; agreedAt?:Date|null; calendarConflict?:boolean; orphanBlock?:boolean}={}){
  const writes:string[]=[];
  const db={query:async(sql:string)=>{
    if(sql.includes('FROM service_requests WHERE id='))return {rows:[{
      id:requestId,offer_id:requestId,status:'ACCEPTED',version:4,
      schedule_reconciliation_required:false,customer_person_id:null,
      guest_contact_id:guestId,seller_professional_id:null,
      seller_organization_id:null,performer_professional_id:null,
    }]};
    if(sql.includes('FROM guest_capabilities cap'))return {rows:[{guest_contact_id:guestId}]};
    if(sql.includes('pg_advisory_xact_lock'))return {rows:[]};
    if(sql.includes('FROM idempotency_records'))return {rows:[]};
    if(sql.includes('FROM schedule_proposals WHERE id='))return {rows:[{
      id:proposalId,revision:2,status:options.status??'PROPOSED',
      initiator:options.initiator??'SELLER',
      proposed_start_at:options.start===undefined?new Date('2027-12-01T10:00:00.000Z'):options.start,
      proposed_end_at:options.end===undefined?new Date('2027-12-01T11:00:00.000Z'):options.end,
      timezone:'Asia/Almaty',
    }]};
    if(sql.includes('SELECT now() AS agreed_at'))return {rows:[{agreed_at:options.agreedAt===undefined?new Date('2026-11-10T00:00:00.000Z'):options.agreedAt}]};
    if(sql.includes('FROM service_requests r JOIN service_offers'))return {rows:[{performer_id:options.calendarConflict?'10000000-0000-4000-8000-000000000005':null,availability:options.calendarConflict?'PUBLIC':'HIDDEN'}]};
    if(sql.includes('FROM cancellation_policies'))return {rows:[{revision:3,free_cancel_before_min:120}]};
    if(sql.includes('FROM busy_blocks WHERE request_id='))return {rows:options.orphanBlock?[{id:'10000000-0000-4000-8000-000000000006'}]:[]};
    if(sql.includes('FROM availability_allocations'))return {rows:[{enabled:true}]};
    if(sql.includes('INSERT INTO busy_blocks')){
      if(options.calendarConflict)throw Object.assign(new Error('calendar overlap'),{code:'23P01'});
      writes.push('busy_block');return {rows:[]};
    }
    if(sql.includes('INSERT INTO cancellation_snapshot_revisions')){writes.push('snapshot_revision');return {rows:[]};}
    if(sql.includes('INSERT INTO cancellation_snapshots')){writes.push('snapshot');return {rows:[]};}
    if(sql.includes('UPDATE service_requests SET scheduled_start_at=')){writes.push('request');return {rows:[{version:5}]};}
    if(sql.includes('UPDATE schedule_proposals SET status=')){writes.push('proposal');return {rows:[]};}
    if(sql.includes('INSERT INTO service_request_events')){writes.push('event');return {rows:[]};}
    if(sql.includes('INSERT INTO domain_outbox_events')){writes.push('outbox');return {rows:[]};}
    if(sql.includes('FROM service_requests r')&&sql.includes('professional_profiles'))return {rows:[{
      professional_person_id:'10000000-0000-4000-8000-000000000004',organization_id:null,
    }]};
    if(sql.includes('INSERT INTO notification_intents')){writes.push('notification');return {rows:[]};}
    if(sql.includes('FROM guest_contacts'))return {rows:[{channel:'email'}]};
    if(sql.includes('INSERT INTO idempotency_records')){writes.push('idempotency');return {rows:[]};}
    throw new Error('Unexpected SQL: '+sql);
  }};
  return {db,writes};
}

test('confirm persists cancellation snapshots, schedule, event and both notifications',async()=>{
  const {db,writes}=fakeDb();
  const result=await mutateScheduleProposal(db as never,args);
  assert.equal(result.status,'confirmed');
  assert.equal(result.request_version,5);
  assert.equal(result.replayed,false);
  assert.equal(result.confirmed_at,'2026-11-10T00:00:00.000Z');
  assert.equal(result.cancellation_deadline_at,'2027-12-01T08:00:00.000Z');
  assert.deepEqual(writes,[
    'snapshot_revision','snapshot','request','proposal','event','outbox',
    'notification','notification','idempotency',
  ]);
});

for(const [description,options] of [
  ['own proposal',{initiator:'CUSTOMER'}],
  ['already declined proposal',{status:'DECLINED'}],
  ['past proposal',{start:new Date('2026-11-09T10:00:00.000Z')}],
  ['reversed time range',{end:new Date('2027-12-01T09:00:00.000Z')}],
  ['zero-duration time range',{end:new Date('2027-12-01T10:00:00.000Z')}],
  ['invalid start timestamp',{start:new Date(Number.NaN)}],
  ['invalid end timestamp',{end:new Date(Number.NaN)}],
  ['null start timestamp',{start:null}],
  ['null end timestamp',{end:null}],
  ['string start timestamp',{start:'2027-12-01T10:00:00.000Z'}],
  ['string end timestamp',{end:'2027-12-01T11:00:00.000Z'}],
  ['missing database agreement time',{agreedAt:null}],
  ['invalid database agreement time',{agreedAt:new Date(Number.NaN)}],
] as const){
  test('confirm rejects '+description+' before writing',async()=>{
    const {db,writes}=fakeDb(options);
    await assert.rejects(mutateScheduleProposal(db as never,args),
      (error:unknown)=>error instanceof ScheduleProposalRejected&&error.reason==='conflict');
    assert.deepEqual(writes,[]);
  });
}

test('calendar exclusion conflict rejects confirmation before snapshots or notifications',async()=>{
  const {db,writes}=fakeDb({calendarConflict:true});
  await assert.rejects(mutateScheduleProposal(db as never,args),
    (error:unknown)=>error instanceof ScheduleProposalRejected&&error.reason==='conflict');
  assert.deepEqual(writes,[]);
});

test('existing busy block without a performer rejects confirmation before writes',async()=>{
  const {db,writes}=fakeDb({orphanBlock:true});
  await assert.rejects(mutateScheduleProposal(db as never,args),
    (error:unknown)=>error instanceof ScheduleProposalRejected&&error.reason==='conflict');
  assert.deepEqual(writes,[]);
});

test('confirmed idempotency replay requires consistent confirmation and cancellation timestamps',async()=>{
  const {createHmac}=await import('node:crypto');
  const hash=createHmac('sha256',pepper)
    .update('schedule-proposal:v1\0')
    .update(JSON.stringify(['confirm',requestId,proposalId,4,null]))
    .digest('hex');
  const valid={
    id:proposalId,request_id:requestId,revision:2,status:'confirmed',
    initiator:'seller',start_at:'2027-12-01T10:00:00.000Z',
    end_at:'2027-12-01T11:00:00.000Z',timezone:'Asia/Almaty',
    request_version:5,replayed:false,
    confirmed_at:'2026-11-10T00:00:00.000Z',
    cancellation_deadline_at:'2027-12-01T08:00:00.000Z',
  };
  for(const invalid of [
    {confirmed_at:undefined},
    {cancellation_deadline_at:undefined},
    {confirmed_at:'2027-12-02T10:00:00.000Z'},
    {cancellation_deadline_at:'2027-12-02T10:00:00.000Z'},
  ]){
    const db={query:async(sql:string)=>{
      if(sql.includes('FROM service_requests WHERE id='))return {rows:[{
        id:requestId,offer_id:requestId,status:'ACCEPTED',version:5,
        schedule_reconciliation_required:false,customer_person_id:null,
        guest_contact_id:guestId,seller_professional_id:null,
        seller_organization_id:null,performer_professional_id:null,
      }]};
      if(sql.includes('FROM guest_capabilities cap'))return {rows:[{guest_contact_id:guestId}]};
      if(sql.includes('pg_advisory_xact_lock'))return {rows:[]};
      if(sql.includes('FROM idempotency_records'))return {rows:[{
        request_hash:hash,state:'COMPLETED',response_body:{...valid,...invalid},
        expires_at:new Date('2099-01-01T00:00:00.000Z'),
      }]};
      throw new Error('Replay unexpectedly attempted SQL mutation: '+sql);
    }};
    await assert.rejects(mutateScheduleProposal(db as never,args),
      (error:unknown)=>error instanceof ScheduleProposalRejected&&error.reason==='conflict');
  }
});
