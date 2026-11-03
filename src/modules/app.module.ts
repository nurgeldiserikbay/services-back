import { Module } from '@nestjs/common';
import { HealthController } from './health/health.controller.js';
import { CatalogModule } from './catalog/catalog.module.js';
import { GeographyModule } from './geography/geography.module.js';
import { DatabaseModule } from '../platform/database/database.module.js';
import { PublicOfferModule } from './offers/public-offer.module.js';

@Module({ imports: [DatabaseModule, CatalogModule, GeographyModule, PublicOfferModule], controllers: [HealthController] })
export class AppModule {}
