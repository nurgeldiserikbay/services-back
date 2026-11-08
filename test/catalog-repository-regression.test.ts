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
  assert.match(calls[0]!.sql, /LIMIT 51 OFFSET \$8::integer/);
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


test('catalog search returns next cursor only when more than 50 results exist', async () => {
  const rows = Array.from({length: 51}, (_, i) => ({kind:'offer', id:String(i), title:String(i), is_sponsored:false}));
  const db = {query: async () => ({rows})} as unknown as DatabasePool;
  const result = await new CatalogRepository(db).search(normalizeSearchFilters({cursor:'50'}));
  assert.equal(result.items.length, 50);
  assert.equal(result.next_cursor, '100');
});


test('catalog never emits cursor outside supported range', async () => {
  const rows = Array.from({length: 51}, (_, i) => ({kind:'offer', id:String(i), title:String(i), is_sponsored:false}));
  const db = {query: async () => ({rows})} as unknown as DatabasePool;
  const result = await new CatalogRepository(db).search(normalizeSearchFilters({cursor:'10000'}));
  assert.equal(result.items.length, 50);
  assert.equal(result.next_cursor, null);
});

test('catalog search exposes the professional slug in its typed result', async () => {
  const db = {
    query: async () => ({
      rows: [{
        kind: 'professional',
        id: '00000000-0000-4000-8000-000000000001',
        title: 'Electrician',
        slug: 'electrician',
        is_sponsored: false,
      }],
    }),
  } as unknown as DatabasePool;
  const result = await new CatalogRepository(db).search(
    normalizeSearchFilters({kind: 'professional'}),
  );
  assert.equal(result.items[0]?.slug, 'electrician');
});
