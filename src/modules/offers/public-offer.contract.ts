import { BadRequestException } from '@nestjs/common';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export type ContactMethod = 'phone' | 'whatsapp' | 'guest_request' | 'book_slot';
export type OfferSellerKind = 'professional' | 'organization';
export type AvailabilityVisibility = 'hidden' | 'busy_only' | 'free_slots';

export interface PublishedServiceOffer {
  id: string;
  definition_id: string;
  title: string;
  seller_kind: OfferSellerKind;
  seller_id: string;
  status: 'published';
  contact_methods: ContactMethod[];
  city_id: string | null;
  price_label: string | null;
  availability_visibility: AvailabilityVisibility;
}

/** Never return raw contact JSON: it may contain private phone numbers or bearer links. */
const ALLOWED_METHODS = new Set<ContactMethod>(['phone', 'whatsapp', 'guest_request', 'book_slot']);
export function publishedContactMethods(raw: unknown): ContactMethod[] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
  const methods = (raw as Record<string, unknown>).methods;
  if (!Array.isArray(methods)) return [];
  const unique = new Set<ContactMethod>();
  for (const method of methods) {
    if (typeof method === 'string' && ALLOWED_METHODS.has(method as ContactMethod)) {
      unique.add(method as ContactMethod);
    }
  }
  return [...unique];
}
export function requireOfferId(raw: string): string {
  if (typeof raw !== 'string' || !UUID.test(raw)) {
    throw new BadRequestException('Invalid offer ID');
  }
  return raw.toLowerCase();
}
