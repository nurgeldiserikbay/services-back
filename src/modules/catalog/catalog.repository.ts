import { Injectable, OnModuleDestroy, ServiceUnavailableException } from '@nestjs/common';
import { Pool } from 'pg';
import type { SearchFilters, SearchItem, SearchResult } from './search-contract.js';

/**
 * Read only from canonically published offers and their visible seller.
 * No real data or unauthorized profile is synthesized when DB is missing.
 * SQL parameters are always bound; requests and contact tables are never queried.
 */
@Injectable()
export class CatalogRepository implements OnModuleDestroy {
  private pool?: Pool;
  private connect(): Pool {
    if (this.pool) return this.pool;
    if (!process.env.DATABASE_URL) throw new ServiceUnavailableException('Public catalog is not connected');
    this.pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 8,
      connectionTimeoutMillis: 3500,
      idleTimeoutMillis: 12000,
      statement_timeout: 4000,
      application_name: 'services-public-search',
    });
    return this.pool;
  }
  async search(filter: SearchFilters): Promise<SearchResult> {
    // Profiles and organizations appear only if an active published offer exists.
    // Prevents listing draft-only, suspended or otherwise non-public sellers.
    const query = `
      WITH published_offers AS (
        SELECT o.id AS offer_id, o.title AS offer_title, o.professional_id, o.organization_id,
               p.title AS professional_title, p.slug AS professional_slug,
               org.name AS organization_title
        FROM service_offers o
        LEFT JOIN professional_profiles p ON p.id = o.professional_id
        LEFT JOIN organizations org ON org.id = o.organization_id
        LEFT JOIN locations loc ON loc.id = o.location_id
        LEFT JOIN cities c ON c.id = COALESCE(o.city_id, loc.city_id)
        WHERE o.status = 'PUBLISHED'
          AND ( (p.id IS NOT NULL AND p.status = 'PUBLISHED') OR
                (org.id IS NOT NULL AND org.status = 'ACTIVE') )
          AND (o.location_id IS NULL OR loc.active = true)
          AND ($3::text = 'any' OR o.delivery_mode = $3::text)
          AND ($4::text = 'global' OR
               ($4::text = 'city' AND c.id = $5::uuid) OR
               ($4::text = 'area' AND c.area_id = $6::uuid) OR
               ($4::text = 'country' AND c.country_id = $7::uuid))
      ),
      candidates AS (
        SELECT 'offer'::text AS kind, offer_id AS id, offer_title AS title
        FROM published_offers
        UNION
        SELECT 'professional'::text AS kind, professional_id AS id,
               COALESCE(NULLIF(professional_title, ''), professional_slug) AS title
        FROM published_offers WHERE professional_id IS NOT NULL
        UNION
        SELECT 'organization'::text AS kind, organization_id AS id, organization_title AS title
        FROM published_offers WHERE organization_id IS NOT NULL
      )
      SELECT kind, id::text, title, false AS is_sponsored
      FROM candidates
      WHERE ($2::text = 'all' OR kind = $2::text)
        AND ($1::text = '' OR position(lower($1::text) in lower(title)) > 0)
      ORDER BY title, kind, id
      LIMIT 50
    `;
    try {
      const res = await this.connect().query<SearchItem>(query, [
        filter.q, filter.kind, filter.deliveryMode, filter.scope,
        filter.cityId, filter.areaId, filter.countryId,
      ]);
      return {items: res.rows, next_cursor:null};
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      // Do not expose database driver errors or query values to public callers.
      throw new ServiceUnavailableException('Public catalog temporarily unavailable');
    }
  }
  async onModuleDestroy(): Promise<void> {
    await this.pool?.end();
  }
}
