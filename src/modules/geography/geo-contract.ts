import { BadRequestException } from '@nestjs/common';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function single(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new BadRequestException('Invalid ' + field);
  return value;
}
export function parseUuid(value: unknown, field: string, required = false): string | null {
  const raw = single(value, field);
  if (!raw) {
    if (required) throw new BadRequestException('Missing ' + field);
    return null;
  }
  if (!UUID.test(raw)) throw new BadRequestException('Invalid ' + field);
  return raw.toLowerCase();
}
export interface CityFilters {
  countryId: string | null;
  areaId: string | null;
  q: string;
}
export function parseCityFilters(input: Record<string, unknown>): CityFilters {
  const countryId = parseUuid(input.country_id, 'country_id');
  const areaId = parseUuid(input.area_id, 'area_id');
  const q = (single(input.q, 'q') ?? '').trim();
  if (q.length > 140) throw new BadRequestException('City search exceeds length limit');
  if (!countryId && !areaId && q.length < 2) {
    throw new BadRequestException('Global city search requires at least two characters');
  }
  return {countryId, areaId, q};
}
export type CountryRow = {id:string;iso2:string;name:string};
export type AreaRow = {id:string;country_id:string;code:string|null;name:string};
export type CityRow = {id:string;country_id:string;area_id:string|null;name:string;timezone:string};
export interface GeoList<T> {items:T[]}
