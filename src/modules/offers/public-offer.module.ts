import { Module } from '@nestjs/common';
import { PublicOfferController } from './public-offer.controller.js';
import { PublicOfferRepository } from './public-offer.repository.js';

@Module({controllers: [PublicOfferController], providers: [PublicOfferRepository]})
export class PublicOfferModule {}
