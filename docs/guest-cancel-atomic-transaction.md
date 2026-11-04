# Verified guest cancellation — atomic database prerequisite

This PR introduces an **internal-only** cancellation operation. It does
**not** mount an HTTP endpoint or expose a cancellation button.

The caller must invoke `GuestCancellationService.cancel` with a server-
obtained, valid request-bound READ_CANCEL proof and expected version.
The service supplies the configured 256-bit HMAC key and owns one
PostgreSQL transaction through `DatabasePool.transaction`.

Inside that transaction the operation:
1. Verifies the capability hash, locks the request row, and rechecks
   proof scope against the exact verified guest contact and request.
2. Checks the expected version, valid guest delivery contact, and the
   original seller destination (organization or professional), never an
   assigned employee. If any recipient is missing, abort the transaction.
3. Loads any immutable accepted-time cancellation snapshot and uses
   database time with the existing pure cancellation policy. Guest
   customer cancellations never create an account reliability event.
4. Makes one version-checked state change, writes a cancellation event,
   request history event and a PII-free domain outbox event.
5. Inserts **two** persistent notification intents: INITIATOR (verified
   guest EMAIL/SMS), COUNTERPARTY (seller IN_APP). All must commit together.
   Provider delivery is handled by separately gated workers.

Tests using PostgreSQL fixtures check the successful pending guest
cancellation, expected version, foreign/expired proofs, duplicate
attempts, exact notification audiences, absence of guest penalties
and atomic rollback when the second notification insert fails.

## Intentionally not live

- No HTTP controller, customer account authentication, seller-initiated
  cancellation, or guest UI cancellation button.
- No automatic SMS/email delivery or assumption that a notification was
  actually delivered; only PENDING intents are persisted.
- No calendar/busy-block reconciliation. Production cancellation of an
  accepted reservation with confirmed schedule requires an explicit
  follow-up transaction that releases owned busy blocks safely and
  accounts for retries/overlapping allocations.
- The next public operation needs a first-party HttpOnly cookie,
  Origin/CSRF enforcement, exact request binding and consistent
  idempotency/replay behavior (including network failure recovery).

Do not enable cancellation endpoints or claim release-readiness based
on these tests alone.
