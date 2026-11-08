import assert from 'node:assert/strict';
import test from 'node:test';
import {BadRequestException} from '@nestjs/common';
import {validateScheduleProposalBody} from '../src/modules/requests/schedule-proposal.contract.js';

const valid = {
  start_at: '2026-11-01T05:30:00.000Z',
  end_at: '2026-11-01T06:30:00.000Z',
  timezone: 'America/New_York',
  local_start_at: '2026-11-01T01:30:00',
  utc_offset_seconds: -14400,
};

test('schedule proposal accepts the first occurrence of a DST fold with its explicit offset', () => {
  const parsed = validateScheduleProposalBody(valid);
  assert.equal(parsed.startAt.toISOString(), valid.start_at);
  assert.equal(parsed.utcOffsetSeconds, -14400);
});

test('schedule proposal accepts the second occurrence of a DST fold with its explicit offset', () => {
  const parsed = validateScheduleProposalBody({
    ...valid,
    start_at: '2026-11-01T06:30:00.000Z',
    end_at: '2026-11-01T07:30:00.000Z',
    utc_offset_seconds: -18000,
  });
  assert.equal(parsed.startAt.toISOString(), '2026-11-01T06:30:00.000Z');
});

test('schedule proposal rejects a nonexistent DST wall time', () => {
  assert.throws(() => validateScheduleProposalBody({
    ...valid,
    start_at: '2026-03-08T07:30:00.000Z',
    end_at: '2026-03-08T08:30:00.000Z',
    local_start_at: '2026-03-08T02:30:00',
    utc_offset_seconds: -18000,
  }), BadRequestException);
});

test('schedule proposal rejects an offset that does not resolve the supplied instant', () => {
  assert.throws(() => validateScheduleProposalBody({
    ...valid,
    utc_offset_seconds: -18000,
  }), BadRequestException);
});

test('schedule proposal rejects extra properties and non-positive intervals', () => {
  assert.throws(() => validateScheduleProposalBody({...valid, customer_person_id: 'spoofed'}), BadRequestException);
  assert.throws(() => validateScheduleProposalBody({...valid, end_at: valid.start_at}), BadRequestException);
});
