import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSearchFilters } from '../src/modules/catalog/search-contract.js';

test('global public search has bounded defaults and no implicit region', () => {
 const result = normalizeSearchFilters({q:'  Астана  '});
 assert.equal(result.q, 'Астана');
 assert.equal(result.scope,'global');
 assert.equal(result.kind,'all');
 assert.equal(result.cityId,null);
});
test('scoped searches need location IDs and never silently fall back globally', () => {
 assert.throws(() => normalizeSearchFilters({scope:'city'}), /requires matching location ID/);
 assert.throws(() => normalizeSearchFilters({scope:'country',country_id:'wrong'}), /Invalid country_id/);
});
test('malformed kind and list-valued inputs are rejected', () => {
 assert.throws(() => normalizeSearchFilters({kind:'admin'}), /Invalid search filter/);
 assert.throws(() => normalizeSearchFilters({q:['x','y']}), /Invalid q/);
 assert.throws(() => normalizeSearchFilters({q:'x'.repeat(181)}), /too long/);
});
