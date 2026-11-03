import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseAllowedOrigins, parsePort } from '../src/platform/config.js';

test('CORS denies wildcard and invalid origins', () => {
  assert.throws(() => parseAllowedOrigins('*'), /Wildcard/);
  assert.throws(() => parseAllowedOrigins('https://example.com/path'), /origin/);
  assert.deepEqual(parseAllowedOrigins('https://a.test,https://a.test,https://b.test'), ['https://a.test', 'https://b.test']);
});
test('empty CORS allowlist is a safe default', () => {
  assert.deepEqual(parseAllowedOrigins(undefined), []);
});
test('port parser rejects invalid and uses default', () => {
  assert.equal(parsePort(undefined), 3001);
  assert.throws(() => parsePort('0'), /PORT/);
  assert.throws(() => parsePort('0.5'), /PORT/);
});
