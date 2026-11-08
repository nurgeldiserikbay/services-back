# Backend integration release gates

Status: **unverified / fail closed**. This is a release acceptance contract, not proof of implementation.

## Gate B1 — identity and OTP
- Only a trusted server-side BFF may call private OTP verification; reject browser-origin bearer forwarding and direct public ingress.
- Configure real OTP provider, expiration, resend throttling, attempt budgets, replay protection, and account enumeration resistance.
- Authenticate service-to-service traffic with a distinct rotatable secret; reject malformed or noncanonical encodings.
- Require pre-auth CSRF/origin controls and per-IP plus per-account rate limits.
- Test: expired OTP, reused OTP, concurrent verification, wrong account, brute force, missing service secret, invalid origin and backend timeout.

## Gate B2 — privileged admin
- Dedicated admin identity/session storage, independent of user and guest sessions; no bootstrap staff by default.
- MFA enrollment, challenge, recovery and recent-MFA policy before sensitive operations.
- Every admin endpoint loads live session, staff state and exact scoped grants from DB. Never trust browser role or scope claims.
- Server authorization rejects anonymous, auditor writes, cross-scope access, self-elevation, stale MFA and revoked sessions.
- Moderation transitions must be transactional, revision-checked and auditable; no PII/secrets in audit records.
- Test session expiry/revocation, staff suspension, role change race, last-owner protection and double-submit conflict.

## Gate B3 — booking journey
- Guest verification → request creation → seller inbox → accept/decline → guest status → cancellation → notifications.
- Verify ownership, cancellation deadlines in IANA time zones, idempotency keys and concurrent updates in real PostgreSQL.
- Verify affiliation constraints and rating consequences only where documented and applicable.
- Outbox delivery must be retryable and deduplicated, with no false delivered state.

## Gate B4 — operations
- On the exact release commit: `npm run db:validate && npm run typecheck && npm run build && npm test`.
- On disposable staging PostgreSQL: `npm run db:migrate`, then `npm run db:smoke`; exercise rollback/recovery from tested backups.
- Confirm Kazakhstan data residency, redacted structured logs, secret rotation, metrics/alerts and restore drills.
- Record commit SHA, migration version, test artifacts, reviewer and timestamp. A local green run is not production approval.

## Integration dependencies
Frontend login must remain OFF until B1 passes. Admin privileged routes must remain OFF until B2 passes. Production release requires B1–B4 and cross-repository E2E verification.
