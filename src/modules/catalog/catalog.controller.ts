import { Controller, Get, Header, Query } from '@nestjs/common';
import { CatalogRepository } from './catalog.repository.js';
import { normalizeSearchFilters, type SearchResult } from './search-contract.js';

@Controller('search')
export class CatalogController {
  constructor(private readonly catalog: CatalogRepository) {}

  @Get()
  @Header('Cache-Control', 'public, max-age=30')
  search(@Query() query: Record<string, unknown>): Promise<SearchResult> {
    return this.catalog.search(normalizeSearchFilters(query));
  }
}
