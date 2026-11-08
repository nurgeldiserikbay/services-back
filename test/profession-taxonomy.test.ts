import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BadRequestException } from '@nestjs/common';
import { TaxonomyController } from '../src/modules/catalog/taxonomy.controller.js';
import { parseProfessionQuery } from '../src/modules/catalog/taxonomy-contract.js';
import { TaxonomyRepository } from '../src/modules/catalog/taxonomy.repository.js';
import type { DatabasePool } from '../src/platform/database/database.pool.js';

test('profession query is optional, trimmed and bounded', () => {
  assert.equal(parseProfessionQuery(undefined), '');
  assert.equal(parseProfessionQuery('  electrician  '), 'electrician');
  assert.throws(() => parseProfessionQuery(['electrician']), BadRequestException);
  assert.throws(() => parseProfessionQuery('x'.repeat(121)), BadRequestException);
});

test('profession directory uses a bound text filter and returns canonical taxonomy rows', async () => {
  const rows = [{
    id: '11111111-1111-4111-8111-111111111111',
    code: 'electrician',
    name: 'Electrician',
  }];
  let sql = '';
  let values: readonly unknown[] = [];
  const db = {
    query: async (query: string, parameters: readonly unknown[]) => {
      sql = query;
      values = parameters;
      return { rows };
    },
  } as unknown as DatabasePool;

  const result = await new TaxonomyRepository(db).professions('electrician');
  assert.deepEqual(result, rows);
  assert.deepEqual(values, ['electrician']);
  assert.match(sql, /FROM professions/);
  assert.match(sql, /ORDER BY name COLLATE "C", code COLLATE "C", id/);
  assert.doesNotMatch(sql, /electrician/);
});

test('public profession controller applies query validation before repository access', async () => {
  const seen: string[] = [];
  const repository = {
    professions: async (query: string) => { seen.push(query); return []; },
  } as unknown as TaxonomyRepository;
  const controller = new TaxonomyController(repository);
  await controller.professions('  roofer  ');
  assert.deepEqual(seen, ['roofer']);
  await assert.rejects(controller.professions(['roofer']), BadRequestException);
});
