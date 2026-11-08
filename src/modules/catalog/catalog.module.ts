import { Module } from '@nestjs/common';
import { CatalogController } from './catalog.controller.js';
import { CatalogRepository } from './catalog.repository.js';
import { PublicProfileController } from './public-profile.controller.js';
import { PublicProfileRepository } from './public-profile.repository.js';
import { TaxonomyController } from './taxonomy.controller.js';
import { TaxonomyRepository } from './taxonomy.repository.js';

@Module({controllers:[CatalogController,PublicProfileController,TaxonomyController], providers:[CatalogRepository,PublicProfileRepository,TaxonomyRepository]})
export class CatalogModule {}
