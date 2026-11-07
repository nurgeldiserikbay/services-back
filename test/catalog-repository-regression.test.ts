import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CatalogRepository } from '../src/modules/catalog/catalog.repository.js';
import type { DatabasePool } from '../src/platform/database/database.pool.js';
import { normalizeSearchFilters } from '../src/modules/catalog/search-contract.js';

test('catalog search binds user text and location instead of interpolating SQL', async () => {
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  const db = {
    query: async (sql: string, values: unknown[]) => {
      calls.push({ sql, values });
      return { rows: [] };
    },
  } as unknown as DatabasePool;
  const repo = new CatalogRepository(db);
  const malicious = "' OR 1=1 --";
  const result = await repo.search(normalizeSearchFilters({ q: malicious }));
  assert.deepEqual(result, { items: [], next_cursor: null });
  assert.equal(calls.length, 1);
  assert.ok(!calls[0]!.sql.includes(malicious));
  assert.equal(calls[0]!.values[0], malicious);
  assert.match(calls[0]!.sql, /o\.status = 'PUBLISHED'/);
  assert.match(calls[0]!.sql, /LIMIT 50/);
});

test('catalog search propagates database unavailability, never fabricates results', async () => {
  const db = {
    query: async () => { throw new Error('database unavailable'); },
  } as unknown as DatabasePool;
  await assert.rejects(
    new CatalogRepository(db).search(normalizeSearchFilters({})),
    /database unavailable/,
  );
});
