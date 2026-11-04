# Cancellation classification core (transaction prerequisite)

This change introduces `classifyRequestCancellation`, a deterministic,
side-effect-free domain function. It encodes approved request cancellation
rules independently of HTTP controllers and database I/O. **It is not an
operational cancellation endpoint.**

## Rules

- Only PENDING and ACCEPTED requests are eligible. Terminal states fail
  closed; callers must still enforce authenticated ownership, row locks,
  expected version and idempotency.
- Every cancellation, even from PENDING, must persist exactly two logical
  notification intents atomically: INITIATOR and COUNTERPARTY. Delivery is
  asynchronous through the existing outbox infrastructure.
- PENDING cancellation is never late and never proposes a reliability
  penalty, regardless of who cancels.
- For ACCEPTED customer cancellation, the immutable accepted-time
  `cancellation_snapshots.free_cancel_until` determines lateness.
  The exact deadline remains free; only a later instant is late.
- A guest cannot receive a signed-in customer reliability event. A
  `customer_penalty_suspended` request cannot receive an automatic
  customer reliability event. Missing confirmed cancellation snapshot is
  not a basis for inventing a late deadline or customer penalty.
- For ACCEPTED provider cancellation, propose a reliability event against
  the **actual original seller** (professional OR organization) regardless
  of an assigned employee. This proposal is not a confirmed score change
  or automatic ban, and no payment penalty is implied.
- A request marked `schedule_reconciliation_required` is blocked until
  authoritative schedule terms are reconciled.
- The classifier never reads a mutable offer cancellation policy; it
  receives the snapshotted deadline. IANA timezone is metadata only:
  comparisons happen using absolute UTC instants.

## Not yet implemented

The next secure transaction must, within one PostgreSQL transaction:
authenticate the actor and guest READ_CANCEL or account session, lock
`service_requests`, validate resource ownership and version, verify
the persisted cancellation snapshot, perform one cancellation state
transition, persist one cancellation event and service request event,
one domain outbox event, **both** notification intents (with valid
recipient and channel), and any proposed reliability record under a
stable dedupe key. It must roll back completely if any required
recipient cannot be resolved.

No frontend cancel button or live route should be enabled before
those transactions, recipient-routing decisions and integration
tests are implemented. Live notification delivery remains a separate
staging/worker gate.
