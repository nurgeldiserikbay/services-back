import { Controller, Get, Header, Query } from '@nestjs/common';
import { GeographyRepository } from './geography.repository.js';
import { parseCityFilters, parseUuid, type AreaRow, type CityRow, type CountryRow, type GeoList } from './geo-contract.js';

@Controller('geo')
export class GeographyController {
  constructor(private readonly repository: GeographyRepository) {}

  @Get('countries')
  @Header('Cache-Control','public, max-age=300')
  countries(): Promise<GeoList<CountryRow>> {
    return this.repository.countries();
  }

  @Get('areas')
  @Header('Cache-Control','public, max-age=300')
  areas(@Query('country_id') countryId: unknown): Promise<GeoList<AreaRow>> {
    return this.repository.areas(parseUuid(countryId,'country_id',true)!);
  }

  @Get('cities')
  @Header('Cache-Control','public, max-age=120')
  cities(@Query() query: Record<string,unknown>): Promise<GeoList<CityRow>> {
    return this.repository.cities(parseCityFilters(query));
  }
}
