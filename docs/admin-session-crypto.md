# Dedicated administrator session cryptography — foundation

This module adds a separate HMAC-SHA256 domain for **platform administrator**
session tokens and cryptographic token generation. It intentionally cannot
authenticate normal account/guest sessions: the domain
`services-platform-admin-session:v1` differs from the regular account session
domain. The opaque token is generated from 32 random bytes and only its HMAC
digest may be persisted.

**No administrator login, privileged API, session persistence, MFA or UI is
enabled by this change.** Treat this as a small prerequisite, not a complete
security boundary.

## Required before production integration

1. Create and review a separate migration for platform admin staff identities,
   sessions, privilege grants and immutable sanitized audit events. Never
   reuse the `sessions` table's account bearer as proof of platform privilege.
2. Generate an independent secret from the regular account token pepper;
   distribute through managed secrets and implement rotation/revocation.
3. Authenticate a dedicated platform admin identity, verify MFA and its
   freshness, then issue tokens only after a transactionally committed session.
4. Every request must check database revocation, expiration, active staff
   status, current role and **authoritative** per-resource grants. Combine
   this proof with `admin-authorization.policy.ts`.
5. Apply CSRF/origin checks for cookie-backed actions, rate limits, audit logging,
   session expiry, device revocation and secure HTTP cache/header policies.
6. Test real PostgreSQL transactions, concurrent revocation and fail-closed
   behavior. Do not enable admin routes until these controls are complete.

Run `npm run typecheck && npm run build && npm test`; CI has to prove results.
