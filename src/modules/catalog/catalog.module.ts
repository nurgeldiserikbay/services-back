import { Module } from '@nestjs/common';
import { CatalogController } from './catalog.controller.js';
import { CatalogRepository } from './catalog.repository.js';

@Module({controllers:[CatalogController], providers:[CatalogRepository]})
export class CatalogModule {}
