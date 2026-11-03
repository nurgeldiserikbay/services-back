import { BadRequestException } from '@nestjs/common';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,158}[a-z0-9])?$/;

export interface PublicProfessional {
  id: string;
  profession_id: string;
  lifecycle_status: 'published';
  slug: string;
  title: string | null;
}
export interface PublicOrganization {
  id: string;
  slug: string;
  name: string;
  status: 'active';
}
export function requirePublicSlug(value: string): string {
  if (typeof value !== 'string' || !SLUG.test(value)) {
    throw new BadRequestException('Invalid professional slug');
  }
  return value;
}
export function requirePublicUuid(value: string): string {
  if (typeof value !== 'string' || !UUID.test(value)) {
    throw new BadRequestException('Invalid organization ID');
  }
  return value.toLowerCase();
}
