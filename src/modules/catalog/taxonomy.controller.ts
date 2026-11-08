import { Controller, Get, Header, Query } from '@nestjs/common';
import { parseProfessionQuery, type TaxonomyItem } from './taxonomy-contract.js';
import { TaxonomyRepository } from './taxonomy.repository.js';

@Controller()
export class TaxonomyController {
  constructor(private readonly taxonomy: TaxonomyRepository) {}

  @Get('professions')
  @Header('Cache-Control', 'public, max-age=300')
  professions(@Query('q') query: unknown): Promise<TaxonomyItem[]> {
    return this.taxonomy.professions(parseProfessionQuery(query));
  }
}
