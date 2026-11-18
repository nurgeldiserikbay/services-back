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

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function parseServiceProfessionId(value:unknown):string|null{
 if(value===undefined)return null;
 if(typeof value!=='string'||!UUID.test(value))throw new BadRequestException('Invalid profession ID');
 return value.toLowerCase();
}
