# Account OTP delivery acceptance gate

Three stages, internal-only. This migration and the corresponding verification/dispatch changes must deploy atomically.

1. **Fail-closed persistence.** `account_auth_challenges.delivery_confirmed_at` is nullable and defaults to NULL. Historical challenges are NOT backfilled to accepted. Every fresh challenge begins unconfirmed even if issuance and budget accounting committed successfully.
2. **Verified provider acceptance.** The private dispatch orchestration calls the provider only after issuance commit, then writes `delivery_confirmed_at=now()` for that challenge only if it is still unconsumed and unexpired. An invalid provider receipt, failure or database acknowledgement error leaves the proof unusable. The existing compensation also attempts to set `consumed_at`, retaining send-rate charges. A crash after INSERT but before acknowledged delivery cannot grant an account session: verification requires `delivery_confirmed_at IS NOT NULL` under row lock and on UPDATE.
3. **PostgreSQL regression.** Tests cover the pre-ack crash window, no attempts or sessions granted while pending, acceptance followed by single use, accepted dispatch with confirmation, refused/default-off delivery remaining unconfirmed, and existing account sign-in tests explicitly simulating trusted delivery confirmation.

## Limitations and rollout

This does **not** implement durable delivery retries or a provider. A provider may have accepted the message immediately before a crash or DB acknowledgement error, leaving the user's delivered code unusable; this is an availability tradeoff, not a privilege escalation. The 5-minute challenge expiry and rate limits remain. Production operations need provider idempotency, metrics, safe reconciliation, expiry cleanup and approved KZ delivery/vendor/data-residency review. Public account OTP/login endpoints remain disabled; device abuse, consent, anti-enumeration, secure web cookie delivery, mobile refresh rotation and E2E remain prerequisites.

Migration `20261107_account_otp_delivery_confirmation` is required before the new app build. Rolling deployments must stop or drain old OTP issuers/verifiers first, since old nodes do not understand the acceptance gate and may attempt to verify challenges without it. Do not allow user-controlled HTTP input to set delivery confirmation.
