# Guest request — security foundation and implementation gates

This branch adds **pure security and validation primitives**, not a live OTP/booking HTTP endpoint. Do not claim that a guest can already book.

## Implemented

- Strict E.164 SMS and conservative email validation (domain normalized, local part unchanged).
- Secure 6-digit OTP generation, purpose-separated keyed HMAC bound to a challenge UUID.
- Time/attempt/consumption eligibility checks. These must be enforced **atomically in PostgreSQL**, not by standalone reads.
- 256-bit random opaque guest capabilities with purpose-separated hashes. Store only hashes; no token in URL, logs or analytics.
- AES-256-GCM random nonce and authenticated encryption for contact at rest.
- Guest request allowlist, consent requirement and idempotency key validation.
- Unit tests including expiry, reuse, tampering, purpose separation and seller-id injection.

## Required before exposing public routes

1. Provide a data-residency-reviewed SMS/email provider, with delivery semantics, no message body logging, explicit sender verification and abusive-recipient suppression. Do **not** emit OTP in an HTTP response or debug log. A configured provider is not optional for production.
2. Inject distinct 32-byte base64 secrets through a secret manager: contact encryption key and keyed digest/OTP/capability pepper. Document rotation and re-encryption/lookup migration. No defaults in code.
3. Persist GuestContact and GuestChallenge using encrypted contact, HMAC lookup and bounded expiry. Atomically throttle at **recipient digest + source IP/network/device + global provider budget**, counting send and verify attempts. Avoid user/contact enumeration while honoring provider delivery failures.
4. Verify an OTP using a single transaction with row lock or atomic update enforcing purpose, expiry, unconsumed state and attempt limits. Increment attempts on incorrect codes; consume challenge before creating CREATE_REQUEST proof. Prevent race/replay.
5. Use one transaction to consume the create capability and insert ServiceRequest from the canonical PUBLISHED ServiceOffer seller identity (professional XOR organization), with idempotent request key, event/outbox and reliable seller notification.
6. Return request-scoped read/cancel capability separately from the create proof; store only its hash. Protect browser session transfer with HttpOnly Secure cookie/BFF, CSRF & Origin checks and strict no-store. Native tokens belong in protected storage.
7. Integration-test real Postgres concurrency, duplicate sends, wrong purpose, expired/consumed codes, revoked/suspended offers, spam budgets, transactional outbox worker retries and data residency. Only then wire a guest form in Web.

The API contract in `nurgeldiserikbay/services/contracts/openapi.yaml` is the source of truth. No payment, quote negotiation or price setting is part of this flow.
