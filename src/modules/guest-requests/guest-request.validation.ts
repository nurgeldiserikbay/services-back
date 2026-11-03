import { BadRequestException } from '@nestjs/common';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9_-]{15,127}$/;

export type GuestRequestInput = {
  serviceOfferId: string;
  note: string | null;
  consentToContact: true;
};

/** Reject unknown keys and never trust seller/price/schedule in a request body. */
export function validateGuestRequestBody(input: unknown): GuestRequestInput {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new BadRequestException('Invalid request');
  const o = input as Record<string, unknown>;
  if (Object.keys(o).some(k => !['service_offer_id','note','consent_to_contact'].includes(k))) {
    throw new BadRequestException('Unexpected request property');
  }
  if (typeof o.service_offer_id !== 'string' || !UUID.test(o.service_offer_id)) {
    throw new BadRequestException('Invalid service_offer_id');
  }
  if (o.consent_to_contact !== true) throw new BadRequestException('Contact consent required');
  if (o.note !== undefined && (typeof o.note !== 'string' || o.note.length > 1000 ||
    /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(o.note))) {
    throw new BadRequestException('Invalid request note');
  }
  return {serviceOfferId:o.service_offer_id.toLowerCase(),
    note: o.note === undefined ? null : (o.note as string).trim(),consentToContact:true};
}

export function validateIdempotencyKey(value: unknown): string {
  if (typeof value !== 'string' || !IDEMPOTENCY_KEY.test(value)) {
    throw new BadRequestException('Invalid Idempotency-Key');
  }
  return value;
}
