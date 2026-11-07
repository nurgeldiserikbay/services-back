# Platform administration authorization — policy foundation

## Delivery state

This change introduces a pure, deny-by-default operation policy and tests in
src/modules/admin/admin-authorization.policy.ts. It does not register an
admin HTTP controller, authenticate sessions, issue resource grants, or
make the Admin UI accessible.

## Policy

- Roles: owner, admin, operator, auditor.
- All roles need an active, authenticated server session, MFA verified in the
  past 15 minutes, and an exact server-issued resource scope.
- Owner: listed moderation, audit, taxonomy and role operations.
- Admin: moderation, audit, taxonomy and role-list read; no role mutation.
- Operator: moderation read/decision and taxonomy read.
- Auditor: moderation/audit/taxonomy read only; no mutations.
- Unknown roles/operations, missing scope, expired session and stale/future
  MFA timestamps are denied.

## Before exposing admin HTTP endpoints

1. Resolve principals only from independent privileged server sessions; never
   treat client-supplied role, grants, MFA time or session expiration as authority.
2. Load current role assignments and grants from authoritative storage, handle
   revocation, and segregate admin sessions from seller/account sessions.
3. Enforce this policy in every handler, then transactionally verify target
   resource, ownership, state and concurrency before writes.
4. Add session/MFA enrollment and recovery, CSRF/origin, network rate limits,
   idempotency and durable sanitized security/audit events.
5. Add HTTP denial and DB integration tests. Run npm run typecheck,
   npm test and npm run build before release.

These pure policy tests are not evidence of functioning admin endpoints.
