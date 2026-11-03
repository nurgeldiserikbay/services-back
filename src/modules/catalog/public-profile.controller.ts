import { BadRequestException, Controller, Get, Header, Param } from '@nestjs/common';
import { PublicProfileRepository } from './public-profile.repository.js';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SLUG=/^[a-z0-9][a-z0-9-]{0,159}$/;

@Controller()
export class PublicProfileController {
  constructor(private readonly profiles: PublicProfileRepository) {}

  @Get('professionals/:slug')
  @Header('Cache-Control','public, max-age=30')
  professional(@Param('slug') slug: string) {
    if (!SLUG.test(slug)) throw new BadRequestException('Invalid slug');
    return this.profiles.professional(slug);
  }

  @Get('organizations/:id')
  @Header('Cache-Control','public, max-age=30')
  organization(@Param('id') id: string) {
    if (!UUID.test(id)) throw new BadRequestException('Invalid organization id');
    return this.profiles.organization(id.toLowerCase());
  }
}
