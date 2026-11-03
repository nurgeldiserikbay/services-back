import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabasePool } from '../../platform/database/database.pool.js';

export type PublicOffer = {
  id: string;
  title: string;
  delivery_mode: string;
  price_label: string | null;
};
export type PublicProfessional = {
  id: string;
  profession_id: string;
  lifecycle_status: 'published';
  slug: string;
  title: string | null;
  offers: PublicOffer[];
};
export type PublicOrganization = {
  id: string;
  slug: string;
  name: string;
  status: 'active';
  offers: PublicOffer[];
};
type ProfessionalRow = {id:string;profession_id:string;slug:string;title:string|null};
type OrganizationRow = {id:string;slug:string;name:string};

/**
 * Public routes only query published profiles and approved offer records.
 * Do NOT join Person/User/GuestContact, expose seller contact JSON, private
 * calendars, company-professional projection or private review evidence.
 */
@Injectable()
export class PublicProfileRepository {
  constructor(private readonly db: DatabasePool) {}

  async professional(slug: string): Promise<PublicProfessional> {
    const {rows} = await this.db.query<ProfessionalRow>(`
      SELECT id::text, profession_id::text, slug, title
      FROM professional_profiles
      WHERE slug = $1 AND status = 'PUBLISHED'
      LIMIT 1
    `,[slug]);
    const profile=rows[0];
    if (!profile) throw new NotFoundException('Public profile not found');
    const offers = await this.db.query<PublicOffer>(`
      SELECT id::text, title, delivery_mode, price_label
      FROM service_offers
      WHERE professional_id = $1::uuid AND status = 'PUBLISHED'
      ORDER BY title,id LIMIT 50
    `,[profile.id]);
    return {
      id:profile.id,profession_id:profile.profession_id,
      lifecycle_status:'published',slug:profile.slug,title:profile.title,
      offers:offers.rows,
    };
  }

  async organization(id: string): Promise<PublicOrganization> {
    const {rows}=await this.db.query<OrganizationRow>(`
      SELECT id::text, slug, name FROM organizations
      WHERE id=$1::uuid AND status = 'ACTIVE'
      LIMIT 1
    `,[id]);
    const organization=rows[0];
    if (!organization) throw new NotFoundException('Public organization not found');
    const offers=await this.db.query<PublicOffer>(`
      SELECT id::text, title, delivery_mode, price_label
      FROM service_offers
      WHERE organization_id=$1::uuid AND status='PUBLISHED'
      ORDER BY title,id LIMIT 50
    `,[id]);
    return {...organization,status:'active',offers:offers.rows};
  }
}
