import { Module } from '@nestjs/common';
import { HealthController } from './health/health.controller.js';
import { CatalogModule } from './catalog/catalog.module.js';
import { PublicOfferModule } from './offers/public-offer.module.js';

@Module({ imports: [CatalogModule, PublicOfferModule], controllers: [HealthController] })
export class AppModule {}
