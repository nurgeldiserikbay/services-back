import { Module } from '@nestjs/common';
import { HealthController } from './health/health.controller.js';
import { CatalogModule } from './catalog/catalog.module.js';
import { GeographyModule } from './geography/geography.module.js';
import { DatabaseModule } from '../platform/database/database.module.js';

@Module({ imports: [DatabaseModule, CatalogModule, GeographyModule], controllers: [HealthController] })
export class AppModule {}
