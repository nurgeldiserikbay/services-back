import { Controller, Get, Header, Param } from '@nestjs/common';
import { PublicOfferRepository } from './public-offer.repository.js';
import { requireOfferId, type PublishedServiceOffer } from './public-offer.contract.js';

@Controller('service-offers')
export class PublicOfferController {
  constructor(private readonly offers: PublicOfferRepository) {}

  @Get(':id')
  @Header('Cache-Control', 'public, max-age=30')
  getPublished(@Param('id') id: string): Promise<PublishedServiceOffer> {
    return this.offers.getPublished(requireOfferId(id));
  }
}
