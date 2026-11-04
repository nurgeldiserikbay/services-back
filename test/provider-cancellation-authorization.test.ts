import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
  assertAuthorizedProviderCancellation, ProviderCancellationForbidden,
  type VerifiedSellerCancellationActor,
} from '../src/modules/requests/provider-cancellation-authorization.js';

const person = '11111111-1111-4111-8111-111111111111';
const professional = '22222222-2222-4222-8222-222222222222';
const organization = '33333333-3333-4333-8333-333333333333';
const foreignOrg = '44444444-4444-4444-8444-444444444444';
const base: VerifiedSellerCancellationActor = {
  personId: person,
  professionalProfileId: null,
  organizationMembership: null,
};

test('verified owner of the original professional seller may cancel', () => {
  assert.doesNotThrow(() => assertAuthorizedProviderCancellation(
    {...base, professionalProfileId: professional},
    {professionalId: professional, organizationId: null},
  ));
  assert.throws(() => assertAuthorizedProviderCancellation(base, {
    professionalId: professional, organizationId: null,
  }), ProviderCancellationForbidden);
});

test('active seller organization grant, not employee assignment, is required', () => {
  const grant = {organizationId: organization, role: 'OPERATOR' as const,
    status: 'ACTIVE' as const, canManageRequests: true};
  assert.doesNotThrow(() => assertAuthorizedProviderCancellation(
    {...base, organizationMembership: grant},
    {professionalId: null, organizationId: organization},
  ));
  for (const membership of [
    {...grant, organizationId: foreignOrg},
    {...grant, role: 'AUDITOR' as const},
    {...grant, status: 'SUSPENDED' as const},
    {...grant, status: 'REVOKED' as const},
    {...grant, canManageRequests: false},
  ]) {
    assert.throws(() => assertAuthorizedProviderCancellation(
      {...base, organizationMembership: membership},
      {professionalId: null, organizationId: organization},
    ), ProviderCancellationForbidden);
  }
  assert.throws(() => assertAuthorizedProviderCancellation(
    {...base, professionalProfileId: professional},
    {professionalId: null, organizationId: organization},
  ), ProviderCancellationForbidden);
});

test('invalid and ambiguous seller context fails closed', () => {
  for (const seller of [
    {professionalId: null, organizationId: null},
    {professionalId: professional, organizationId: organization},
    {professionalId: 'not-uuid', organizationId: null},
  ]) {
    assert.throws(() => assertAuthorizedProviderCancellation(base, seller),
      ProviderCancellationForbidden);
  }
  assert.throws(() => assertAuthorizedProviderCancellation(
    {...base, personId: 'invalid'},
    {professionalId: professional, organizationId: null},
  ), ProviderCancellationForbidden);
});
