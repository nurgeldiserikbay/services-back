# Registered seller end-to-end integration: verified OTP → request decision

This PR adds **three real PostgreSQL integration stages**, reusing production domain primitives instead of creating parallel authentication or seller logic.

## Stage 1 — account OTP and seller inbox

A registered ACTIVE organization administrator is authenticated through a SIGN_IN OTP challenge after simulated trusted delivery confirmation. The verified OTP is consumed once and issues an opaque account bearer. Session resolution returns the actual user identity and a safe non-secret inventory. That identity is used to read the seller-scoped inbox (without selecting a seller ID from browser input).

## Stage 2 — decision, outbox and idempotency

The same bearer is used by `decideWithIdempotentSession` to accept a pending request. The test checks the request version, unchanged unconfirmed schedule, pending inbox removal, one durable accepted domain event, and one customer notification intent. Repeating the same decision with the same idempotency key returns a replay response without duplicating the event or notification. No price negotiation or auto-reserved calendar times are introduced.

## Stage 3 — permission and session revocation

A separate test confirms that revoking organization membership rejects even an already stored idempotency replay; the user can no longer see the seller inbox. Another test revokes the current bearer and ensures no subsequent seller decision succeeds. The request remains pending after an unauthorized attempt.

## Test boundaries / remaining gaps

These are database-transaction integration tests with an explicitly simulated **approved provider acknowledgement**. They do **not** send an SMS/email, exercise a browser cookie/BFF, invoke a deployed HTTP server, or perform a real end-user signup. All fixtures roll back; no secrets are logged. No public account OTP/login is exposed here.

Next production stages: KZ-compatible verified OTP provider and trusted ingress device limits; reviewed signup/consent; web BFF login issuance and CSRF integration; deployed HTTP/browser E2E; notification worker delivery. Treat a green DB integration suite as a backend workflow milestone, not end-to-end production readiness.
