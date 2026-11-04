# Pending request cancellation: transactional write primitive

This PR implements `cancelAuthorizedPendingRequest` as a database
**transaction participant**, not a public HTTP endpoint. The caller
must first authenticate and resource-authorize the registered person or seller membership. The provided principal
type is an INTERNAL trusted assertion, not a request-body DTO.
The caller MUST execute it inside one `DatabasePool.transaction()`
and roll back on any exception. There is no route, controller,
dependency injection registration, or public release switch.

## Atomic behavior

- `SELECT ... FOR UPDATE` locks the exact request before authorization
  and state/version checks, preventing concurrent double cancellation.
- Only **PENDING** requests qualify; ACCEPTED and terminal requests fail
  closed until confirmed scheduling, reliability weight/formula and
  cancel terms have been implemented.
- Customer identity must equal the request's registered person;
  guest requests are rejected by this primitive and handled by the
  separate PR #38 READ_CANCEL flow. Provider identity must match the original
  professional or organization seller. Authorization is rechecked
  under the row lock, even after the caller's prior ACL check.
- Uses the classifier from PR #36; pending cancellation is not late,
  does not produce a customer or provider reliability event, and
  requires both notification audiences.
- Validates both recipients before mutations. Registered persons use IN_APP; the seller is notified via original organization
  or professional person's IN_APP identity.
- Updates request state/version and inserts exactly one cancellation
  event, a service request event, one PII-free domain outbox event,
  and two durable `notification_intents`: INITIATOR and COUNTERPARTY.
  Foreign keys and unique cancellation/request indexes provide
  further database-level integrity.
- A failed recipient lookup, stale version, or transaction error
  causes the caller's outer transaction to roll back all writes.
  The unit does not send SMS/email or claim actual delivery.

## Not yet done

A secure HTTP or account-session handler must independently verify
session, actor and role, issue a stable idempotency key, enforce CSRF
for web browser requests, and map errors without exposing resource
existence. Neither cancellation nor reliability score changes should
be public until the accepted-time cancellation path, scheduling
snapshot semantics, rights, notification provider and full PostgreSQL
+ E2E tests are reviewed. Avoid declaring this production-ready
solely because CI passes.

## Parallel work boundary

PR #38 implements guest READ_CANCEL authentication and guest cancellation. This
PR does not perform guest cancellations, does not replace PR #38, and must not
be exposed through any public route. Maintain separate transactions until
both authorization paths are reviewed and tested.
