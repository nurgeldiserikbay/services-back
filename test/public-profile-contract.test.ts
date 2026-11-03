import assert from 'node:assert/strict';
import { test } from 'node:test';
import { requirePublicSlug, requirePublicUuid } from '../src/modules/catalog/public-profile-contract.js';

test('public profile slugs are constrained to canonical safe URL form', () => {
  assert.equal(requirePublicSlug('master-electrician'),'master-electrician');
  for (const bad of ['','../../admin','ABC','bad/slug','bad slug','a'.repeat(162)]) {
    assert.throws(() => requirePublicSlug(bad));
  }
});
test('organization ID is canonical UUID and rejects invalid values', () => {
  assert.equal(requirePublicUuid('0FD94272-7F15-4CBE-A1A9-B79678DB23AB'),'0fd94272-7f15-4cbe-a1a9-b79678db23ab');
  assert.throws(() => requirePublicUuid('nope'));
});
