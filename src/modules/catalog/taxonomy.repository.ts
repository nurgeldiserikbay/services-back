import { Inject, Injectable } from '@nestjs/common';
import { DatabasePool } from '../../platform/database/database.pool.js';
import type { TaxonomyItem } from './taxonomy-contract.js';

@Injectable()
export class TaxonomyRepository {
  constructor(@Inject(DatabasePool) private readonly db: DatabasePool) {}

  async professions(query: string): Promise<TaxonomyItem[]> {
    const result = await this.db.query<TaxonomyItem>(`
      SELECT id::text, code, name
      FROM professions
      WHERE ($1::text = '' OR position(lower($1::text) in lower(name)) > 0)
      ORDER BY name COLLATE "C", code COLLATE "C", id
    `, [query]);
    return result.rows;
  }
  async serviceDefinitions(professionId:string|null):Promise<TaxonomyItem[]>{
    const result=await this.db.query<TaxonomyItem>(`
      SELECT s.id::text, s.code, s.name
      FROM service_definitions s
      WHERE ($1::uuid IS NULL OR EXISTS (
        SELECT 1 FROM profession_services ps
        WHERE ps.service_id=s.id AND ps.profession_id=$1::uuid
      ))
      ORDER BY s.name COLLATE "C", s.code COLLATE "C", s.id
    `,[professionId]);
    return result.rows;
  }
}
