import { BadRequestException } from '@nestjs/common';

export interface TaxonomyItem {
  id: string;
  code: string;
  name: string;
}

export function parseProfessionQuery(value: unknown): string {
  if (value === undefined) return '';
  if (typeof value !== 'string') throw new BadRequestException('Invalid profession query');
  const query = value.trim();
  if (query.length > 120) throw new BadRequestException('Profession query exceeds length limit');
  return query;
}
