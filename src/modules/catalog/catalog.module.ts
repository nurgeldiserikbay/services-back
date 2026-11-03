import { Module } from '@nestjs/common';
import { CatalogController } from './catalog.controller.js';
import { PublicProfileController } from './public-profile.controller.js';
import { CatalogRepository } from './catalog.repository.js';

@Module({controllers:[CatalogController, PublicProfileController], providers:[CatalogRepository]})
export class CatalogModule {}
