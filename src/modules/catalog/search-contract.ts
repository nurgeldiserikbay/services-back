import { BadRequestException } from '@nestjs/common';

export type CatalogKind = 'all' | 'offer' | 'professional' | 'organization';
export type SearchScope = 'city' | 'area' | 'country' | 'global';
export type DeliveryMode = 'any' | 'at_location' | 'at_customer' | 'online';

export interface SearchFilters {
  q: string;
  kind: CatalogKind;
  scope: SearchScope;
  cityId: string | null;
  areaId: string | null;
  countryId: string | null;
  deliveryMode: DeliveryMode;
  cursor: string | null;
}
export interface SearchItem {
  kind: 'offer' | 'professional' | 'organization';
  id: string;
  title: string;
  is_sponsored: boolean;
}
export interface SearchResult { items: SearchItem[]; next_cursor: string | null }

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const scopes: SearchScope[] = ['city','area','country','global'];
const kinds: CatalogKind[] = ['all','offer','professional','organization'];
const modes: DeliveryMode[] = ['any','at_location','at_customer','online'];

function stringValue(value: unknown, name: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new BadRequestException('Invalid ' + name);
  return value;
}
function idValue(value: unknown, name: string): string | null {
  const s = stringValue(value, name);
  if (!s) return null;
  if (!uuid.test(s)) throw new BadRequestException('Invalid ' + name);
  return s.toLowerCase();
}
export function normalizeSearchFilters(input: Record<string, unknown>): SearchFilters {
  const q = (stringValue(input.q, 'q') ?? '').trim();
  if (q.length > 180) throw new BadRequestException('Search query too long');
  const kind = stringValue(input.kind, 'kind') ?? 'all';
  const scope = stringValue(input.scope, 'scope') ?? 'global';
  const deliveryMode = stringValue(input.delivery_mode, 'delivery_mode') ?? 'any';
  if (!kinds.includes(kind as CatalogKind) || !scopes.includes(scope as SearchScope) ||
      !modes.includes(deliveryMode as DeliveryMode)) throw new BadRequestException('Invalid search filter');
  const cityId = idValue(input.city_id, 'city_id');
  const areaId = idValue(input.area_id, 'area_id');
  const countryId = idValue(input.country_id, 'country_id');
  const cursor = stringValue(input.cursor, 'cursor') ?? null;
  if (cursor !== null && (!/^[0-9]{1,5}$/.test(cursor) || Number(cursor) > 10000)) {
    throw new BadRequestException('Invalid cursor');
  }
  if ((scope === 'city' && (areaId || countryId)) ||
      (scope === 'area' && (cityId || countryId)) ||
      (scope === 'country' && (cityId || areaId)) ||
      (scope === 'global' && (cityId || areaId || countryId))) {
    throw new BadRequestException('Unexpected location for selected scope');
  }
  // A scoped search without a specific region cannot be silently expanded worldwide.
  if ((scope === 'city' && !cityId) || (scope === 'area' && !areaId) ||
      (scope === 'country' && !countryId)) {
    throw new BadRequestException('Selected search scope requires matching location ID');
  }
  return {q,kind:kind as CatalogKind,scope:scope as SearchScope,deliveryMode:deliveryMode as DeliveryMode,cityId,areaId,countryId,cursor};
}
