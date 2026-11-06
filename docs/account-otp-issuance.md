# Account OTP challenge issuance — private infrastructure

This PR continues the merged PR #51 verification primitives. These are internal building blocks, **not** an enabled sign-in flow.

## Stage 1 — atomic challenge creation

`issueAccountOtpChallenge` validates and normalizes email/SMS destinations, creates a purpose-bound OTP and stores an HMAC lookup digest, AES-256-GCM encrypted destination and OTP hash in `account_auth_challenges`. The three secrets are independently configured (`ACCOUNT_OTP_HMAC_KEY`, `ACCOUNT_CONTACT_HMAC_KEY`, `ACCOUNT_CONTACT_ENCRYPTION_KEY`) and must differ. Only the private in-process return includes plaintext delivery code and contact. No public route or logging is added.

Call this helper inside `DatabasePool.transaction`: its per-contact advisory transaction lock serializes issuance across instances. It enforces a minimum 60-second same-contact cooldown and at most 3 created challenges per 10 minutes (across both sign-in and sign-up purposes).

## Stage 2 — delivery boundary

`AccountOtpDeliveryPort` defines the private adapter contract. The default implementation always refuses delivery. Receipt sanitization rejects arbitrary provider payloads. This intentionally does not choose a commercial provider or expose OTP codes in HTTP, outbox, analytics or logs.

## Stage 3 — PostgreSQL integration tests

Real database tests cover hashed codes, encrypted contacts, purpose binding, expiration interval, same-contact and cross-purpose cooldown, secret separation and delivery-default-deny.

## Release blockers

No account API endpoints have been mounted. Before public issuance: establish verified email/SMS provider and safe message templates; anti-enumeration uniform responses; per-contact **plus** network/device/global send quotas; rate limits and operational monitoring; abuse handling and provider dispatch with transactional durability and sanitized audit; purpose-aware consent for sign-up; contact-to-ACTIVE-user matching for sign-in; account session issuance, revocation and refresh behavior; and browser/mobile E2E. The per-contact quota here is deliberately not sufficient for public deployment. Guest OTP proof never converts into an account login. The caller must commit transaction for successful challenge creation and must not expose the returned code or destination beyond approved delivery.

Policy: Services ADR-0005 and backend `AGENTS.md`.
