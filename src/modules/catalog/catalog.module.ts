import { Module } from '@nestjs/common';
import { CatalogController } from './catalog.controller.js';
import { CatalogRepository } from './catalog.repository.js';
import { PublicProfileController } from './public-profile.controller.js';
import { PublicProfileRepository } from './public-profile.repository.js';

@Module({controllers:[CatalogController,PublicProfileController], providers:[CatalogRepository,PublicProfileRepository]})
export class CatalogModule {}
