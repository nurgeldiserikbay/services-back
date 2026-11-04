# Accepted late cancellation with proposed, review-gated reliability

This change introduces `cancelAcceptedLateByRegisteredCustomer` as an
**internal PostgreSQL transaction participant**. It does not mount an HTTP
route, expose an endpoint to browsers, or apply score changes.

## Hard requirements

- Caller authenticates the registered customer, enforces CSRF/ACL and
  owns the complete BEGIN/COMMIT/ROLLBACK transaction.
- The supplied reliability configuration MUST come from reviewed trusted
  server configuration, never the browser: `formulaVersion`,
  `lateCustomerWeight` (positive, bounded decimal string), `approvalId`.
  There is **no implicit default** or approved deployment policy in this PR.
- Lock the exact ACCEPTED request, check owner/version and reconcile the
  persisted cancellation snapshot against the confirmed schedule.
- Reject open schedule proposals, missing/mismatched snapshots,
  reconciliations, stale versions and cancellations before or at the free
  cancellation cutoff. That early path belongs to PR #39.
- Classify lateness using database wall-clock instant and the snapshotted
  deadline, not the current offer policy or browser clock.
- In a single transaction: transition to CANCELLED_BY_CUSTOMER, release
  only matching request busy blocks, persist cancellation event, audit and
  outbox events, and **both** notification intents.
- If the request has no active customer-penalty suspension, insert one
  deduplicated `reliability_events` row with `PROPOSED` status and a
  reviewed formula version. Never create EFFECTIVE automatically.
- If `customer_penalty_suspended` is true, still cancel and notify both
  parties, but do not propose a reliability event.

## Limitations and next steps

The required policy values and approval are deliberately unresolved:
operations must not enable a public route or silently invent scores.
Actual reliability publication requires a separately reviewed
review/appeal pipeline, not merely this domain transaction.

This does not implement seller-initiated accepted cancellation, guest
READ_CANCEL flows, production OTP delivery, account-session HTTP,
idempotent replay ledger, notification worker or user-facing buttons.
Complete E2E, scheduling race and transaction rollback tests are mandatory
before production activation.
