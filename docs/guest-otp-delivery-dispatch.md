# Internal guest OTP delivery dispatch

The `GuestOtpDispatchService` connects the committed, quota-limited
CREATE_REQUEST challenge issuance with the existing `OtpDeliveryService`.

On accepted provider delivery it returns **only** challenge ID and OTP expiry.
It never returns recipient contact, plaintext OTP, or provider metadata.
The module registers a disabled-by-default delivery adapter through an
explicit NestJS factory. No HTTP endpoints or real delivery provider are enabled.

If delivery fails or a provider returns a rejected receipt, the orchestrator
attempts to mark the committed challenge as consumed. The original issuance
**remains counted against the send quota**; it is never refunded. Revocation
failures are swallowed to avoid leaking DB/provider details and the public-facing
result still fails closed, but if the database is unavailable a challenge may
remain unrevoked until its natural expiry. A true delivery status therefore
requires an approved provider, durable status tracking and recovery monitoring.

## Still required before exposure

- Reviewed Kazakhstan-region SMS/email provider and durable send status.
- Global, network and recipient abuse budgets; verification-side throttling.
- Origin/CSRF-checked same-origin BFF with HttpOnly scoped guest session.
- Generic HTTP replies to avoid contact enumeration; request-level idempotency.
- End-to-end and failure/recovery tests on staging, plus incident monitoring.

Unit tests assert safe successful projection and delivery failure behavior.
This is **not** a live guest-request flow or a production readiness claim.
