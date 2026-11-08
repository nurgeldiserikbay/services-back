import { Injectable } from '@nestjs/common';
import { DatabasePool } from '../../platform/database/database.pool.js';
import type { TaxonomyItem } from './taxonomy-contract.js';

@Injectable()
export class TaxonomyRepository {
  constructor(private readonly db: DatabasePool) {}

  async professions(query: string): Promise<TaxonomyItem[]> {
    const result = await this.db.query<TaxonomyItem>(`
      SELECT id::text, code, name
      FROM professions
      WHERE ($1::text = '' OR position(lower($1::text) in lower(name)) > 0)
      ORDER BY name COLLATE "C", code COLLATE "C", id
    `, [query]);
    return result.rows;
  }
}
