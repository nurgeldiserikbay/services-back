# Accepted appointment: early registered-customer cancellation

This PR adds a narrowly scoped **internal transactional primitive**, not a
public cancellation endpoint. It is a follow-up to the merged PENDING and
guest cancellation transactions.

## Allowed

A trusted caller must authenticate a registered customer, authorize the
request resource, and wrap `cancelAcceptedEarlyByCustomer` inside a single
PostgreSQL `DatabasePool.transaction()`.

The operation:

- Locks the service request and verifies customer identity, version and
  `ACCEPTED` state.
- Requires confirmed start/end, accepted timestamp, timezone and an
  immutable cancellation snapshot consistent with the request.
- Uses PostgreSQL clock time and the snapshot deadline. Only strictly
  *before or at* the free cancellation cutoff proceeds.
- Refuses pending schedule proposals or reconciliation-required requests.
- Changes the request to `CANCELLED_BY_CUSTOMER`, releases busy blocks
  scoped to exactly that request, writes audit/cancellation/outbox events
  and both recipient notification intents in one transaction.
- Writes **no reliability penalty** for an on-time cancellation.
- Rejects stale versions, duplicate cancels, missing snapshots or
  unresolvable recipients, without claiming successful notification
  delivery.

## Out of scope / blocked

The function does **not** handle late accepted cancellation or provider
cancellation. Both may require a proposed reliability event. Formula
weights, suppression/review policy and temporal acceptance rules require
separate approval and tests; none are invented here.

Guest cancellations must continue to use the separately authenticated
READ_CANCEL path. Neither guest cancellation, registered account sessions,
seller-membership authorization, HTTP CSRF, idempotency replay ledger nor
actual SMS/email delivery are introduced by this PR. The operation must
not be exposed as a public HTTP endpoint until those integrations and
complete E2E tests have been reviewed.

The transaction is caller-owned; a failure after updating state requires
ROLLBACK of the entire operation, including outbox and busy block changes.
