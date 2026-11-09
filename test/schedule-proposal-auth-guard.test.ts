import assert from 'node:assert/strict';
import test from 'node:test';
import {UnauthorizedException} from '@nestjs/common';
import {mutateScheduleProposal, ScheduleProposalRejected} from '../src/modules/requests/schedule-proposal.transaction.js';

const requestId = '10000000-0000-4000-8000-000000000001';
const pepper = Buffer.alloc(32, 1);

for (const action of ['propose', 'decline', 'confirm'] as const) {
  test(`schedule ${action} rejects unauthenticated requests before querying the database`, async () => {
    let queryCount = 0;
    const client = {
      query: async () => {
        queryCount++;
        throw new Error('Unauthenticated request must not reach the database');
      },
    };
    await assert.rejects(
      mutateScheduleProposal(client as never, {
        requestId,
        action,
        expectedVersion: 1,
        key: 'no-auth-test',
        pepper,
        ...(action === 'propose'
          ? {input: {
              startAt: new Date('2026-11-11T10:00:00.000Z'),
              endAt: new Date('2026-11-11T11:00:00.000Z'),
              timezone: 'Asia/Almaty',
              localStartAt: '2026-11-11T15:00:00',
              utcOffsetSeconds: 18000,
            }}
          : {proposalId: '10000000-0000-4000-8000-000000000002'}),
      }),
      UnauthorizedException,
    );
    assert.equal(queryCount, 0);
  });
}

test('invalid guest schedule capability cannot reach proposal mutations', async () => {
  const statements: string[] = [];
  const client = {
    query: async (sql: string) => {
      statements.push(sql);
      if (sql.includes('FROM service_requests WHERE id=')) {
        return {rows: [{
          id: requestId, offer_id: requestId, status: 'ACCEPTED', version: 1,
          schedule_reconciliation_required: false,
          customer_person_id: null, guest_contact_id: requestId,
          seller_professional_id: null, seller_organization_id: null,
          performer_professional_id: null,
        }]};
      }
      throw new Error('Invalid capability must not trigger additional queries');
    },
  };
  await assert.rejects(
    mutateScheduleProposal(client as never, {
      requestId, action: 'confirm', proposalId: requestId,
      expectedVersion: 1, key: 'invalid-guest-proof',
      guestCapability: 'not-a-capability',
      pepper, guestPepper: pepper,
    }),
    (error: unknown) => error instanceof ScheduleProposalRejected && error.reason === 'forbidden',
  );
  assert.equal(statements.length, 1);
  assert.match(statements[0], /FOR UPDATE/);
});

test('well-formed but unrecognized guest capability is denied before mutations', async () => {
  const statements: string[] = [];
  const client = {
    query: async (sql: string) => {
      statements.push(sql);
      if (sql.includes('FROM service_requests WHERE id=')) {
        return {rows: [{
          id: requestId, offer_id: requestId, status: 'ACCEPTED', version: 1,
          schedule_reconciliation_required: false,
          customer_person_id: null, guest_contact_id: requestId,
          seller_professional_id: null, seller_organization_id: null,
          performer_professional_id: null,
        }]};
      }
      if (sql.includes('FROM guest_capabilities cap')) return {rows: []};
      throw new Error('Unrecognized guest proof must not trigger mutations');
    },
  };
  await assert.rejects(
    mutateScheduleProposal(client as never, {
      requestId, action: 'decline', proposalId: requestId,
      expectedVersion: 1, key: 'unknown-guest-proof',
      guestCapability: 'A'.repeat(43),
      pepper, guestPepper: pepper,
    }),
    (error: unknown) => error instanceof ScheduleProposalRejected && error.reason === 'forbidden',
  );
  assert.equal(statements.length, 2);
  assert.match(statements[1], /scope='MANAGE_SCHEDULE'/);
});

for (const action of ['propose', 'decline', 'confirm'] as const) {
  test(`schedule ${action} returns not_found for a missing request without checking guest proofs`, async () => {
    const statements: string[] = [];
    const client = {
      query: async (sql: string) => {
        statements.push(sql);
        if (sql.includes('FROM service_requests WHERE id=')) return {rows: []};
        throw new Error('Missing request must not trigger any further queries');
      },
    };
    await assert.rejects(
      mutateScheduleProposal(client as never, {
        requestId, action, expectedVersion: 1, key: 'missing-request',
        guestCapability: 'A'.repeat(43), pepper, guestPepper: pepper,
        ...(action === 'propose'
          ? {input: {
              startAt: new Date('2026-11-11T10:00:00.000Z'),
              endAt: new Date('2026-11-11T11:00:00.000Z'),
              timezone: 'Asia/Almaty',
              localStartAt: '2026-11-11T15:00:00',
              utcOffsetSeconds: 18000,
            }}
          : {proposalId: requestId}),
      }),
      (error: unknown) => error instanceof ScheduleProposalRejected && error.reason === 'not_found',
    );
    assert.equal(statements.length, 1);
    assert.match(statements[0], /FOR UPDATE/);
  });
}
