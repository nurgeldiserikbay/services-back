import assert from 'node:assert/strict';
import { test } from 'node:test';
import { publishedContactMethods, requireOfferId } from '../src/modules/offers/public-offer.contract.js';

test('public ID rejects unsafe or malformed input', () => {
  const id = '0FD94272-7F15-4CBE-A1A9-B79678DB23AB';
  assert.equal(requireOfferId(id), id.toLowerCase());
  for(const invalid of ['','/etc/passwd','123','not-a-uuid','0fd94272-7f15-4cbe-a1a9-b79678db23ab?debug=1']) {
    assert.throws(() => requireOfferId(invalid));
  }
});
test('contact method projection is allowlisted and does not expose raw secrets', () => {
  const raw = {methods:['whatsapp','phone','whatsapp','hacker','guest_request'],
    phone:'+77770000000',auth_token:'private',deep_link:'secret'};
  assert.deepEqual(publishedContactMethods(raw),['whatsapp','phone','guest_request']);
  assert.deepEqual(publishedContactMethods({phone:'+77001231212'}),[]);
  assert.deepEqual(publishedContactMethods(null),[]);
  assert.deepEqual(publishedContactMethods(['phone']),[]);
});
