# Guest Request — Transaction Runner

Status: **internal backend service only**, not a working public request endpoint.

This milestone adds `DatabasePool.transaction(work)`, which owns the single PostgreSQL connection, starts a transaction, enforces 3-second lock and 8-second statement budgets, commits only after all writes, rolls back on failure, and releases the client. A failed rollback discards the connection; uncertain commit outcomes MUST NOT be retried blindly.

The `GuestRequestService` validates canonical guest inquiry input, idempotency and opaque CREATE_REQUEST proof format; it checks that 256-bit base64 `GUEST_REQUEST_HMAC_KEY` and `GUEST_CONTACT_ENCRYPTION_KEY` are both configured and distinct; then calls the existing transaction core using exactly one checked-out client.

These variables are names only: **do not commit values**. Provision via an approved Kazakhstan-resident secret manager, with encryption-key rotation, HMAC pepper rollover and incident response. The service is deliberately not registered as a route.

## Verification

Real PostgreSQL integration tests prove connection consistency, committed transaction reuse, rollback recovery and absence of a half-written idempotency record. Earlier PR #7 tests exercise successful creation, one seller outbox notification intent, replay, paused offer rejection and OTP proof.

## Still required before public use

- Real OTP delivery provider, per-identity/network rate limiting and provider spend controls
- Browser BFF with HttpOnly cookie, Origin and CSRF protection
- Secure capability recovery/expiry/rotation and never putting bearer tokens in URLs
- Cross-process duplicate submissions and crash/failure recovery tests
- Reliable notification worker and customer-side confirmation delivery
- Security review, deployment proof and updated progress checklist

Do not create a fake booking button or claim that the public request is enabled.
