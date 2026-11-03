import { Controller, Get, Header, Param } from '@nestjs/common';
import { requirePublicSlug, requirePublicUuid } from './public-profile-contract.js';
import { PublicProfileRepository } from './public-profile.repository.js';

@Controller()
export class PublicProfileController {
  constructor(private readonly profiles: PublicProfileRepository) {}

  @Get('professionals/:slug')
  @Header('Cache-Control','public, max-age=30')
  professional(@Param('slug') slug: string) {
    return this.profiles.professional(requirePublicSlug(slug));
  }

  @Get('organizations/:id')
  @Header('Cache-Control','public, max-age=30')
  organization(@Param('id') id: string) {
    return this.profiles.organization(requirePublicUuid(id));
  }
}
