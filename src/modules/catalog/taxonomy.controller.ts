import { Controller, Get, Header, Inject, Query } from '@nestjs/common';
import { parseProfessionQuery, parseServiceProfessionId, type TaxonomyItem } from './taxonomy-contract.js';
import { TaxonomyRepository } from './taxonomy.repository.js';

@Controller()
export class TaxonomyController {
  constructor(@Inject(TaxonomyRepository) private readonly taxonomy: TaxonomyRepository) {}

  @Get('professions')
  @Header('Cache-Control', 'public, max-age=300')
  professions(@Query('q') query: unknown): Promise<TaxonomyItem[]> {
    return this.taxonomy.professions(parseProfessionQuery(query));
  }
  @Get('service-definitions')
  @Header('Cache-Control', 'public, max-age=300')
  serviceDefinitions(@Query('profession_id') professionId:unknown):Promise<TaxonomyItem[]>{
    return this.taxonomy.serviceDefinitions(parseServiceProfessionId(professionId));
  }
}
