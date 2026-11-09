import assert from 'node:assert/strict';
import test from 'node:test';
import {UnauthorizedException} from '@nestjs/common';
import {mutateScheduleProposal} from '../src/modules/requests/schedule-proposal.transaction.js';

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
