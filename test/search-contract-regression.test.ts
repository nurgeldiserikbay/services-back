import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BadRequestException } from '@nestjs/common';
import { encodeSearchCursor, normalizeSearchFilters } from '../src/modules/catalog/search-contract.js';

const city = '11111111-1111-4111-8111-111111111111';

test('search defaults to global, all types, any delivery mode', () => {
  assert.deepEqual(normalizeSearchFilters({}), {
    q: '', kind: 'all', professionId: null, scope: 'global', cityId: null, areaId: null,
    countryId: null, deliveryMode: 'any', cursor: null,
  });
});

test('search trims query and normalizes UUID casing', () => {
  const result = normalizeSearchFilters({
    q: '  electrician  ', scope: 'city', city_id: city.toUpperCase(),
    kind: 'professional', delivery_mode: 'at_customer',
  });
  assert.equal(result.q, 'electrician');
  assert.equal(result.cityId, city);
  assert.equal(result.kind, 'professional');
  assert.equal(result.deliveryMode, 'at_customer');
});

test('search rejects missing location for scoped search', () => {
  for (const scope of ['city', 'area', 'country']) {
    assert.throws(() => normalizeSearchFilters({ scope }), BadRequestException);
  }
});

test('search rejects invalid and repeated query parameters', () => {
  for (const input of [
    { q: ['one', 'two'] },
    { kind: 'unknown' },
    { scope: 'city', city_id: 'not-a-uuid' },
    { delivery_mode: 'teleport' },
    { q: 'x'.repeat(181) },
  ]) {
    assert.throws(() => normalizeSearchFilters(input), BadRequestException);
  }
});

test('search never silently widens invalid scoped location', () => {
  assert.throws(() => normalizeSearchFilters({ scope: 'country', city_id: city }), BadRequestException);
});


test('search validates and decodes opaque keyset cursors', () => {
  const encoded = encodeSearchCursor({
    title: 'Electrician', kind: 'professional',
    id: '11111111-1111-4111-8111-111111111111',
  });
  assert.deepEqual(normalizeSearchFilters({cursor: encoded}).cursor, {
    title: 'Electrician', kind: 'professional',
    id: '11111111-1111-4111-8111-111111111111',
  });
  for (const cursor of ['50', '-1', 'abc', '1.5', 'e30=', 'eyJ4IjoxfQ', ['0']]) {
    assert.throws(() => normalizeSearchFilters({cursor}), BadRequestException);
  }
});
