# Backend parallel work handoff

Canonical coordination: https://github.com/nurgeldiserikbay/services/blob/main/docs/parallel-delivery-board.md

**Ownership:** API semantics, SQL migrations, authorization, OTP, admin sessions/MFA, request transitions, outbox and server-enforced cancellation policy. Do not implement frontend/admin presentation.

## Current slice
1. Run `npm run typecheck && npm test && npm run build` on exact main commit; repair any regressions before extending features.
2. Review moderation read service and tests; verify no DB access on disabled/invalid bearer, scope checks, row bounds, duplicate IDs, no-store headers and fresh session/MFA. Use real PostgreSQL for session/grant behavior.
3. Deliver admin MFA/session issuance only with reviewed provisioning, revocation, brute-force and audit design; do not turn on public admin routes prematurely.
4. Confirm trusted OTP private ingress, real provider, CSRF and rate limits before enabling account login.
5. Publish reviewed operation/DTO/error contract changes to shared docs before frontend/admin adoption.

**Done when:** CI green, PostgreSQL migration + rollback evidence, negative authorization tests, exact commit SHA and staged HTTP proof. Keep secrets out of logs. Existing docs/integration-release-gates.md remains binding.
