import { Controller, Get, Header, Param } from '@nestjs/common';
import { CatalogRepository } from './catalog.repository.js';
import { requirePublicSlug, requirePublicUuid, type PublicOrganization, type PublicProfessional } from './public-profile-contract.js';

@Controller()
export class PublicProfileController {
  constructor(private readonly catalog: CatalogRepository) {}

  @Get('professionals/:slug')
  @Header('Cache-Control','public, max-age=30')
  professional(@Param('slug') slug: string): Promise<PublicProfessional> {
    return this.catalog.publicProfessional(requirePublicSlug(slug));
  }

  @Get('organizations/:id')
  @Header('Cache-Control','public, max-age=30')
  organization(@Param('id') id: string): Promise<PublicOrganization> {
    return this.catalog.publicOrganization(requirePublicUuid(id));
  }
}
