# Alert episode dispatch lease — prepared, not activated

This document tracks the preserved functionality from [PR #149](https://github.com/nurgeldiserikbay/services-back/pull/149) adapted to the current main branch without replacing the established `external-delivery-alert-dispatch.ts` aggregate transport boundary.

## Internal boundaries

- `claimExternalAlertEvent(db, leaseSeconds)` from `external-delivery-alert-dispatch-lease.ts` claims at most one immutable `notification_alert_events` episode with a 30–300-second PostgreSQL lease and a random fencing token. The calling job **must begin a transaction and commit the claim before external I/O**.
- `acknowledgeExternalAlertEvent(db, eventId, leaseToken)` accepts only the current unexpired claim; stale and expired tokens are rejected. A separate committed ACK transaction is needed after transport acknowledgment.
- `notification_alert_dispatches` stores only event ID, lease state, attempt count, and successful delivery timestamp. No provider token, response body, contact details, payload or destination is stored.
- The PostgreSQL regression `test/external-delivery-alert-dispatch-lease-db.test.ts` tests expired lease/reclaim, stale ACK rejection and successful ACK, plus early input validation.

## Not operationally ready

No automatic scheduler, provider binding, job transaction wrapper, provider idempotency implementation, production paging or on-call integration is activated. A crash after provider send but before ACK can replay the same event: the **real provider MUST deduplicate** by a stable episode key such as `(code, generation)`. Lease fencing alone does not provide exactly-once delivery. All transport secrets and tenant data must remain outside the episode table. Obtain incident response, retention, retry/claim cadence, staging drill and SLO owner sign-off before production activation.

Do not merge the stale PR #149 changes to `MASTER_CHECKLIST.md` over newer evidence; record the merged replacement PR separately.
