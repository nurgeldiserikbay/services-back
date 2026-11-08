import { BadRequestException } from '@nestjs/common';

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const LOCAL_WALL_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/;

export type ScheduleProposalInput = {
  startAt: Date;
  endAt: Date;
  timezone: string;
  localStartAt: string;
  utcOffsetSeconds: number;
};

/**
 * Validate the UTC instant and its local-time evidence together. This rejects
 * nonexistent DST wall times and requires an explicit offset for repeated
 * wall times. No horizon is imposed here: ADR-0006 leaves that product rule
 * open, so callers must not invent one at the transport boundary.
 */
export function validateScheduleProposalBody(value: unknown): ScheduleProposalInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BadRequestException('Invalid schedule proposal');
  }
  const body = value as Record<string, unknown>;
  const allowed = new Set(['start_at', 'end_at', 'timezone', 'local_start_at', 'utc_offset_seconds']);
  if (Object.keys(body).some((key) => !allowed.has(key))) {
    throw new BadRequestException('Unexpected schedule proposal property');
  }
  if (typeof body.start_at !== 'string' || !ISO_UTC.test(body.start_at) ||
      typeof body.end_at !== 'string' || !ISO_UTC.test(body.end_at)) {
    throw new BadRequestException('start_at and end_at must be UTC ISO timestamps');
  }
  const startAt = new Date(body.start_at);
  const endAt = new Date(body.end_at);
  if (!validUtcTimestamp(body.start_at, startAt) || !validUtcTimestamp(body.end_at, endAt) || endAt <= startAt) {
    throw new BadRequestException('Invalid schedule interval');
  }
  if (typeof body.timezone !== 'string' || body.timezone.length < 1 || body.timezone.length > 64 ||
      typeof body.local_start_at !== 'string' || !LOCAL_WALL_TIME.test(body.local_start_at) ||
      typeof body.utc_offset_seconds !== 'number' || !Number.isSafeInteger(body.utc_offset_seconds) ||
      body.utc_offset_seconds < -50400 || body.utc_offset_seconds > 50400) {
    throw new BadRequestException('Invalid local schedule details');
  }

  const wall = body.local_start_at;
  const wallDate = new Date(`${wall}Z`);
  if (!Number.isFinite(wallDate.getTime()) || formatUtcWall(wallDate) !== wall) {
    throw new BadRequestException('Invalid local_start_at');
  }

  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: body.timezone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hourCycle: 'h23',
    });
  } catch {
    throw new BadRequestException('timezone must be a valid IANA time zone');
  }
  if (formatter.resolvedOptions().timeZone !== body.timezone) {
    throw new BadRequestException('timezone must use its canonical IANA name');
  }
  const actualWall = formatZonedWall(formatter, startAt);
  const actualOffset = (Date.parse(`${actualWall}Z`) - Math.floor(startAt.getTime() / 1000) * 1000) / 1000;
  if (actualWall !== wall || actualOffset !== body.utc_offset_seconds) {
    throw new BadRequestException('Local time or UTC offset does not match start_at and timezone');
  }

  return {
    startAt,
    endAt,
    timezone: body.timezone,
    localStartAt: wall,
    utcOffsetSeconds: body.utc_offset_seconds,
  };
}

function formatUtcWall(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, '').replace(/Z$/, '');
}

function validUtcTimestamp(value: string, date: Date): boolean {
  if (!Number.isFinite(date.getTime())) return false;
  return formatUtcWall(date) === value.replace(/(?:\.\d{1,3})?Z$/, '');
}

function formatZonedWall(formatter: Intl.DateTimeFormat, date: Date): string {
  const parts = Object.fromEntries(formatter.formatToParts(date).map(({ type, value }) => [type, value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
}
