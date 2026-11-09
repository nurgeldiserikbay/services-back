import assert from 'node:assert/strict';
import test from 'node:test';
import {mutateScheduleProposal, ScheduleProposalRejected} from '../src/modules/requests/schedule-proposal.transaction.js';
import {hashGuestCapability} from '../src/modules/guest-requests/guest-request.security.js';

const requestId = '10000000-0000-4000-8000-000000000001';
const proposalId = '10000000-0000-4000-8000-000000000002';
const guestId = '10000000-0000-4000-8000-000000000003';
const pepper = Buffer.alloc(32, 7);
const token = 'A'.repeat(43);

function fakeDb(options: {version?:number; initiator?:string; proposalStatus?:string; savedHash?:string} = {}) {
  const sqls: string[] = [];
  const events: string[] = [];
  const db = {
    query: async (sql: string, params: unknown[] = []) => {
      sqls.push(sql);
      if (sql.includes('FROM service_requests WHERE id=')) return {rows: [{
        id:requestId, offer_id:requestId, status:'ACCEPTED',
        version:options.version ?? 4, schedule_reconciliation_required:false,
        customer_person_id:null, guest_contact_id:guestId,
        seller_professional_id:null, seller_organization_id:null,
        performer_professional_id:null,
      }]};
      if (sql.includes('FROM guest_capabilities cap')) {
        assert.equal(params[1], hashGuestCapability('MANAGE_SCHEDULE',token,pepper));
        return {rows:[{guest_contact_id:guestId}]};
      }
      if (sql.includes('pg_advisory_xact_lock')) return {rows:[]};
      if (sql.includes('FROM idempotency_records')) return {rows:options.savedHash ? [{request_hash:options.savedHash,state:'COMPLETED',response_body:{},expires_at:new Date('2099-01-01')}] : []};
      if (sql.includes('FROM schedule_proposals WHERE id=')) return {rows:[{
        id:proposalId, revision:2, status:options.proposalStatus ?? 'PROPOSED',
        initiator:options.initiator ?? 'SELLER',
        proposed_start_at:new Date('2026-12-01T10:00:00.000Z'),
        proposed_end_at:new Date('2026-12-01T11:00:00.000Z'),
        timezone:'Asia/Almaty',
      }]};
      if (sql.includes('UPDATE schedule_proposals')) {events.push('declined');return {rows:[]};}
      if (sql.includes('UPDATE service_requests SET version=')) {events.push('version');return {rows:[]};}
      if (sql.includes('INSERT INTO service_request_events')) {events.push('event');return {rows:[]};}
      if (sql.includes('INSERT INTO domain_outbox_events')) {events.push('outbox');return {rows:[]};}
      if (sql.includes('FROM service_requests r') && sql.includes('professional_profiles')) {
        return {rows:[{professional_person_id:'10000000-0000-4000-8000-000000000004',organization_id:null}]};
      }
      if (sql.includes('INSERT INTO notification_intents')) {events.push('notification');return {rows:[]};}
      if (sql.includes('INSERT INTO idempotency_records')) {events.push('idempotency');return {rows:[]};}
      throw new Error('Unexpected SQL in schedule lifecycle test: '+sql);
    },
  };
  return {db,sqls,events};
}

const args = {
  requestId, proposalId, action:'decline' as const,
  expectedVersion:4, key:'decline-guest-test', guestCapability:token,
  pepper, guestPepper:pepper,
};

test('guest declines seller proposal and emits event, outbox and notification', async () => {
  const {db,events} = fakeDb();
  const result = await mutateScheduleProposal(db as never,args);
  assert.deepEqual({
    id:result.id,status:result.status,initiator:result.initiator,
    revision:result.revision,request_version:result.request_version,replayed:result.replayed,
  },{
    id:proposalId,status:'declined',initiator:'seller',
    revision:2,request_version:5,replayed:false,
  });
  assert.deepEqual(events,['declined','version','event','outbox','notification','idempotency']);
});

test('guest cannot decline a proposal initiated by the same side', async () => {
  const {db,events} = fakeDb({initiator:'CUSTOMER'});
  await assert.rejects(mutateScheduleProposal(db as never,args),
    (error:unknown) => error instanceof ScheduleProposalRejected && error.reason==='conflict');
  assert.deepEqual(events,[]);
});

test('guest cannot decline an already resolved proposal', async () => {
  const {db,events} = fakeDb({proposalStatus:'CONFIRMED'});
  await assert.rejects(mutateScheduleProposal(db as never,args),
    (error:unknown) => error instanceof ScheduleProposalRejected && error.reason==='conflict');
  assert.deepEqual(events,[]);
});

test('stale request version cannot mutate a proposal', async () => {
  const {db,events,sqls} = fakeDb({version:5});
  await assert.rejects(mutateScheduleProposal(db as never,args),
    (error:unknown) => error instanceof ScheduleProposalRejected && error.reason==='conflict');
  assert.deepEqual(events,[]);
  assert.equal(sqls.some(sql=>sql.includes('FROM schedule_proposals WHERE id=')),false);
});

test('reusing an idempotency key for a different request body is rejected before mutation', async () => {
  const {db,events,sqls} = fakeDb({savedHash:'different-payload-hash'});
  await assert.rejects(mutateScheduleProposal(db as never,args),
    (error:unknown) => error instanceof ScheduleProposalRejected && error.reason==='conflict');
  assert.deepEqual(events,[]);
  assert.equal(sqls.some(sql=>sql.includes('FROM schedule_proposals WHERE id=')),false);
});
