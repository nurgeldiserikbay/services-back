# Native/server seller-decision HTTP endpoints

This PR opens two **bearer-only** endpoints using already merged account session verification, per-request seller authorization, existing atomic state transitions, outbox events and client notification intents:

- POST /v1/requests/{id}/accept
- POST /v1/requests/{id}/decline

Both require `Authorization: Bearer <opaque-account-session>`, `If-Match: "<positive-version>"`, and `Idempotency-Key: <16-128-char-key>`. These routes NEVER accept browser cookies or seller IDs and do not rely on the frontend to authorize a request. The server checks session and seller ACL even on a replay.

The mutation and idempotency ledger are committed in the SAME PostgreSQL transaction. The ledger stores a non-PII decision reply, not any bearer token. Same-key identical retries replay the result; conflicting payloads/expired ledger entries reject; concurrent requests serialize through row/advisory locks. Guest client notifications remain delivery intents until the provider worker exists.

IMPORTANT: Account login/session issuance and full native consumer UX are still missing, so these endpoints cannot yet be exercised by normal users. Browser web uses a secure same-origin BFF with HttpOnly cookie, CSRF and Origin verification; global backend CORS remains read-only and does not permit cross-origin browser mutations. Session rotation, audit trails, rate limiting and compliance review are still release gates.

OpenAPI currently defines the POST actions with Idempotency-Key; this implementation additionally requires If-Match for optimistic concurrency. Canonical OpenAPI must be aligned before clients generate SDKs.
