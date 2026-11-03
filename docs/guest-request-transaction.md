# Guest request transaction core — implemented, not publicly exposed

Status: internal PostgreSQL domain operation with integration tests. There is **no HTTP POST /v1/guest-requests yet**. The flow must remain unavailable publicly until vetted contact delivery, abuse controls, browser capability transport, and worker runtime are implemented.

## Transaction contract

`createGuestRequestInTransaction(client, body, createProof, idempotencyKey, pepper, encryptionKey)`

- Caller validates `body` via `validateGuestRequestBody`, `idempotencyKey` via `validateIdempotencyKey`, and obtains a verified CREATE_REQUEST bearer proof.
- Caller **MUST** pass a dedicated PostgreSQL connection and execute `BEGIN` / `COMMIT`, rolling back on any exception. Never call the function through the shared auto-committing `DatabasePool.query` facade.
- Lock one CREATE_REQUEST capability; serialize keys per guest scope using transaction-scoped advisory lock.
- Replay of a completed identical request uses an AES-256-GCM encrypted idempotency reply; same key with different payload is rejected. No raw bearer token in stored `response_body`.
- Read the canonical published ServiceOffer (professional XOR organization) under a row lock, check seller and location status. Ignore seller IDs supplied by clients; the request has no price negotiation.
- Insert pending `ServiceRequest`, `ServiceRequestEvent`, safe `DomainOutboxEvent`, one seller `NotificationIntent`, and a separate request-scoped READ_CANCEL capability, then consume the one-time CREATE_REQUEST proof.
- No message is sent inline. The outbox worker must enforce at-least-once delivery and notification deduplication.
- OTP verification SQL now sets the contact's `verified_at` only on successful code consumption, in the same atomic statement.

## Required before HTTP exposure

1. Verified Kazakhstan-residency-compliant SMS/email delivery provider, abuse limits by recipient/network/device and global spend quota, generic enumeration-safe responses.
2. Secret manager with **distinct** 256-bit pepper/encryption keys, recovery and rotation procedures.
3. Authenticated browser BFF HttpOnly cookie with CSRF/Origin checks, no sensitive tokens in URLs, analytics or browser-visible server logs. Native capability goes in secure storage.
4. Postgres request transaction orchestration with vetted error/status mapping, real commit/rollback boundary, replay proof invalidation policy, and cancellation/recovery flow.
5. Worker and recipient notification ACL, retry/dead-letter tests, staging endpoint smoke, privacy audit, real mobile UX.
6. Cross-process concurrency and crash recovery tests beyond the initial single-connection integration regression. Production rollback and operational runbook.

All user-facing claims must distinguish **transaction core** from **working booking form**.
