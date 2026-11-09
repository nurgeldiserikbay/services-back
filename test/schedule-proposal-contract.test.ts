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

test('schedule proposal rejects malformed UTC dates and reversed intervals', () => {
  for (const start_at of [
    '2026-02-30T05:30:00.000Z',
    '2026-11-01T05:30:00+00:00',
    '2026-11-01T05:30:00.0000Z',
  ]) {
    assert.throws(() => validateScheduleProposalBody({...valid, start_at}), BadRequestException);
  }
  assert.throws(() => validateScheduleProposalBody({
    ...valid, end_at: '2026-11-01T04:30:00.000Z',
  }), BadRequestException);
});

test('schedule proposal rejects invalid local wall dates and noncanonical zones', () => {
  for (const local_start_at of [
    '2026-11-31T01:30:00',
    '2026-11-01T25:30:00',
    '2026-11-01T01:30:00Z',
  ]) {
    assert.throws(() => validateScheduleProposalBody({...valid, local_start_at}), BadRequestException);
  }
  for (const timezone of ['Not/A_Zone', 'US/Eastern', '']) {
    assert.throws(() => validateScheduleProposalBody({...valid, timezone}), BadRequestException);
  }
});

test('schedule proposal rejects unsafe offsets and missing required evidence', () => {
  for (const utc_offset_seconds of [-50401, 50401, 0.5, Number.NaN]) {
    assert.throws(() => validateScheduleProposalBody({...valid, utc_offset_seconds}), BadRequestException);
  }
  const {utc_offset_seconds: _offset, ...withoutOffset} = valid;
  assert.throws(() => validateScheduleProposalBody(withoutOffset), BadRequestException);
});

test('schedule proposal accepts Kazakhstan local time with a positive UTC offset', () => {
  const parsed = validateScheduleProposalBody({
    start_at: '2026-11-10T04:15:00.000Z',
    end_at: '2026-11-10T05:15:00.000Z',
    timezone: 'Asia/Almaty',
    local_start_at: '2026-11-10T09:15:00',
    utc_offset_seconds: 18000,
  });
  assert.equal(parsed.localStartAt, '2026-11-10T09:15:00');
  assert.equal(parsed.utcOffsetSeconds, 18000);
});

test('schedule proposal validates local calendar date across a UTC day boundary', () => {
  const parsed = validateScheduleProposalBody({
    start_at: '2026-11-09T20:30:00.000Z',
    end_at: '2026-11-09T21:30:00.000Z',
    timezone: 'Asia/Almaty',
    local_start_at: '2026-11-10T01:30:00',
    utc_offset_seconds: 18000,
  });
  assert.equal(parsed.startAt.toISOString(), '2026-11-09T20:30:00.000Z');
  assert.equal(parsed.localStartAt, '2026-11-10T01:30:00');
});

test('schedule proposal rejects a Kazakhstan wall time with the wrong offset', () => {
  assert.throws(() => validateScheduleProposalBody({
    start_at: '2026-11-10T04:15:00.000Z',
    end_at: '2026-11-10T05:15:00.000Z',
    timezone: 'Asia/Almaty',
    local_start_at: '2026-11-10T09:15:00',
    utc_offset_seconds: 21600,
  }), BadRequestException);
});
