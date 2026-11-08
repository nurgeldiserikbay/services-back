import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CatalogRepository } from '../src/modules/catalog/catalog.repository.js';
import type { DatabasePool } from '../src/platform/database/database.pool.js';
import { encodeSearchCursor, normalizeSearchFilters } from '../src/modules/catalog/search-contract.js';

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
  assert.match(calls[0]!.sql, /LIMIT 51/);
  assert.match(calls[0]!.sql, /COALESCE\(title, ''\) COLLATE "C"/);
  assert.ok(!calls[0]!.sql.includes('OFFSET'));
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


test('catalog returns an opaque keyset cursor anchored to the last returned result', async () => {
  const rows = Array.from({length: 51}, (_, i) => ({
    kind: 'offer' as const,
    id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
    title: `Offer ${String(i).padStart(2, '0')}`,
    slug: null,
    is_sponsored: false,
  }));
  let values: unknown[] = [];
  const db = { query: async (_sql: string, parameters: unknown[]) => { values = parameters; return {rows}; } } as unknown as DatabasePool;
  const result = await new CatalogRepository(db).search(normalizeSearchFilters({}));
  assert.equal(result.items.length, 50);
  assert.deepEqual(normalizeSearchFilters({cursor: result.next_cursor}).cursor, {
    title: 'Offer 49', kind: 'offer', id: '00000000-0000-4000-8000-000000000050',
  });
  assert.deepEqual(values.slice(7), [null, null, null]);
});

test('catalog applies keyset cursor values as bound SQL parameters', async () => {
  let values: unknown[] = [];
  const db = { query: async (_sql: string, parameters: unknown[]) => { values = parameters; return {rows: []}; } } as unknown as DatabasePool;
  const cursor = encodeSearchCursor({
    title: 'First result', kind: 'professional', id: '00000000-0000-4000-8000-000000000001',
  });
  await new CatalogRepository(db).search(normalizeSearchFilters({cursor}));
  assert.deepEqual(values.slice(7), [
    'First result', 'professional', '00000000-0000-4000-8000-000000000001',
  ]);
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
