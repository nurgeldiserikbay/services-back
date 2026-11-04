/**
 * Internal fail-closed authorization boundary for seller-initiated cancellation.
 *
 * This function DOES NOT authenticate callers or query organization membership.
 * The service layer must verify the session, resolve live membership/ownership
 * from trusted storage under the same transaction, enforce CSRF/idempotency,
 * lock the request, and then pass the verified facts here.
 *
 * The assigned employee is never the seller and cannot cancel merely because
 * they were assigned to perform the appointment.
 */
export type VerifiedSellerCancellationActor = Readonly<{
  personId: string;
  professionalProfileId: string | null;
  organizationMembership: Readonly<{
    organizationId: string;
    role: 'OWNER' | 'ADMIN' | 'OPERATOR' | 'AUDITOR';
    status: 'ACTIVE' | 'SUSPENDED' | 'REVOKED';
    /** Verified from the currently effective, server-side permission set. */
    canManageRequests: boolean;
  }> | null;
}>;

export type OriginalRequestSeller = Readonly<{
  professionalId: string | null;
  organizationId: string | null;
}>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isUuid = (value: unknown): value is string =>
  typeof value === 'string' && UUID.test(value);

export class ProviderCancellationForbidden extends Error {
  constructor() { super('provider_cancellation_forbidden'); }
}

/**
 * Must be called with trusted, transaction-consistent ownership/membership.
 * Denies ambiguous seller ownership and any permission inferred from employee
 * assignment, request body, client-provided flags or arbitrary organization IDs.
 */
export function assertAuthorizedProviderCancellation(
  actor: VerifiedSellerCancellationActor,
  seller: OriginalRequestSeller,
): void {
  if (!actor || !seller || !isUuid(actor.personId) ||
      !((isUuid(seller.professionalId) && seller.organizationId === null) ||
        (seller.professionalId === null && isUuid(seller.organizationId)))) {
    throw new ProviderCancellationForbidden();
  }

  if (seller.professionalId !== null) {
    // The trusted owner profile must be resolved for this very person.
    if (actor.professionalProfileId === null ||
        !isUuid(actor.professionalProfileId) ||
        actor.professionalProfileId.toLowerCase() !==
          seller.professionalId.toLowerCase()) {
      throw new ProviderCancellationForbidden();
    }
    return;
  }

  const membership = actor.organizationMembership;
  if (!membership || !isUuid(membership.organizationId) ||
      membership.organizationId.toLowerCase() !==
        seller.organizationId!.toLowerCase() ||
      membership.status !== 'ACTIVE' ||
      !['OWNER', 'ADMIN', 'OPERATOR'].includes(membership.role) ||
      membership.canManageRequests !== true) {
    throw new ProviderCancellationForbidden();
  }
}
