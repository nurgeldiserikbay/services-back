# Account OTP vendor adapter — private handoff only

## Stage 1: safe send boundary

`AccountOtpTemplateDeliveryAdapter` implements the existing disabled-by-default `AccountOtpDeliveryPort`. An operator must explicitly instantiate it with an approved vendor callback and an independent 32-byte HMAC delivery key. It is **not registered in NestJS** and does not select a vendor or read credentials from environment variables.

The callback receives only `AccountOtpRenderedMessage` (validated Kazakh/Russian email/SMS copy and normalized destination from the upstream dispatch) and an opaque idempotency key. Challenge IDs, user identity, database records and account/session bearer tokens do not cross the transport callback. Both arguments are confidential and must not be logged.

## Stage 2: deduplication and receipt confirmation

The adapter computes a stable, domain-separated HMAC-SHA256 over the internal challenge UUID, encoded as URL-safe base64 (43 characters). Repeated attempts to deliver the *same challenge* reuse this key; different challenges or secrets produce different keys. Approved vendor integrations **must honor this key as a send-idempotency token** (or implement equivalent durable deduplication) to limit accidental duplicate OTP messages. Never expose the key to browsers.

The adapter demands an exact `{accepted:boolean,providerRef:string|null}` receipt, then passes it through `sanitizeAccountOtpReceipt`. Rejections, unrecognized receipt fields, invalid IDs, sender exceptions and malformed messages all raise the same generic `AccountOtpDeliveryUnavailable`, without leaking provider errors.

## Stage 3: integration and security gates

Unit tests cover kk/ru delivery, stable and secret-dependent idempotency tokens, exact receipt shape, sender failures and fail-closed input. Merge backend PR #70 then PR #72, and finally this PR, retargeting each stacked PR to main after its parent merges.

**Not production-ready**: An injected callback is not an actual SMS/email provider. Provider review must cover Kazakhstan data-residency and recipient privacy, sender credentials, network cancellation/timeouts, vendor idempotency guarantees, anti-enumeration, opt-in/consent, metrics without PII, delivery failure reconciliation, and a real end-to-end login/cookie issuance flow. The existing 8-second dispatch deadline does not cancel a vendor's in-flight network call.
