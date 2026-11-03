import { Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { DatabasePool } from '../../platform/database/database.pool.js';
import { publishedContactMethods, type PublishedServiceOffer } from './public-offer.contract.js';

type OfferRecord = {
  id: string;
  definition_id: string;
  title: string;
  professional_id: string | null;
  organization_id: string | null;
  city_id: string | null;
  price_label: string | null;
  availability: 'HIDDEN' | 'BUSY_ONLY' | 'FREE_SLOTS';
  contacts: unknown;
};

/**
 * Public read model. SQL deliberately does not select owner identity, private
 * schedule, phone number, member data, company professional view or request data.
 * Raw contacts JSON is examined server-side only to choose approved method names.
 */
@Injectable()
export class PublicOfferRepository {
  constructor(private readonly db: DatabasePool) {}

  async getPublished(id: string): Promise<PublishedServiceOffer> {
    const sql = `
      SELECT o.id::text, o.definition_id::text, o.title,
             o.professional_id::text, o.organization_id::text,
             o.city_id::text, o.price_label, o.availability, o.contacts
      FROM service_offers o
      LEFT JOIN professional_profiles p ON p.id = o.professional_id
      LEFT JOIN organizations org ON org.id = o.organization_id
      LEFT JOIN locations loc ON loc.id = o.location_id
      WHERE o.id = $1::uuid
        AND o.status = 'PUBLISHED'
        AND ((o.professional_id IS NOT NULL AND o.organization_id IS NULL AND p.status = 'PUBLISHED')
          OR (o.organization_id IS NOT NULL AND o.professional_id IS NULL AND org.status = 'ACTIVE'))
        AND (o.location_id IS NULL OR loc.active = true)
      LIMIT 1
    `;
    let row: OfferRecord | undefined;
    try {
      const result = await this.db.query<OfferRecord>(sql, [id]);
      row = result.rows[0];
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      throw new ServiceUnavailableException('Public offer temporarily unavailable');
    }
    if (!row) throw new NotFoundException();
    const seller_kind = row.professional_id ? 'professional' : 'organization';
    const seller_id = row.professional_id ?? row.organization_id;
    if (!seller_id) throw new NotFoundException();
    const visibility = row.availability.toLowerCase();
    if (!['hidden', 'busy_only', 'free_slots'].includes(visibility)) {
      throw new ServiceUnavailableException('Public offer temporarily unavailable');
    }
    return {
      id: row.id,
      definition_id: row.definition_id,
      title: row.title,
      seller_kind,
      seller_id,
      status: 'published',
      contact_methods: publishedContactMethods(row.contacts),
      city_id: row.city_id,
      price_label: row.price_label,
      availability_visibility: visibility as PublishedServiceOffer['availability_visibility'],
    };
  }

}
