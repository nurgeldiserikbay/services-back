import { Injectable } from '@nestjs/common';
import { DatabasePool } from '../../platform/database/database.pool.js';
import type { CountryRow, AreaRow, CityRow, CityFilters, GeoList } from './geo-contract.js';

@Injectable()
export class GeographyRepository {
  constructor(private readonly db: DatabasePool) {}

  async countries(): Promise<GeoList<CountryRow>> {
    const result = await this.db.query<CountryRow>(
      'SELECT id::text, iso2, name FROM countries ORDER BY iso2 ASC', []);
    return {items:result.rows};
  }

  async areas(countryId:string): Promise<GeoList<AreaRow>> {
    const result = await this.db.query<AreaRow>(
      'SELECT id::text, country_id::text, code, name FROM geo_areas WHERE country_id=$1::uuid ORDER BY name,id',
      [countryId]);
    return {items:result.rows};
  }

  async cities(filter: CityFilters): Promise<GeoList<CityRow>> {
    // Bound search substrings, no interpolated SQL or percent-wildcard treatment.
    const result = await this.db.query<CityRow>(`
      SELECT id::text, country_id::text, area_id::text, name, timezone
      FROM cities
      WHERE ($1::uuid IS NULL OR country_id = $1::uuid)
        AND ($2::uuid IS NULL OR area_id = $2::uuid)
        AND ($3::text = '' OR position(lower($3::text) in lower(name)) > 0)
      ORDER BY name,id
      LIMIT 50
    `, [filter.countryId, filter.areaId, filter.q]);
    return {items:result.rows};
  }
}
