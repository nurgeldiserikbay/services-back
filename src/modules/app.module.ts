import { Module } from '@nestjs/common';
import { HealthController } from './health/health.controller.js';
import { CatalogModule } from './catalog/catalog.module.js';

@Module({ imports: [CatalogModule], controllers: [HealthController] })
export class AppModule {}
