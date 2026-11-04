# Internal guest OTP verification

GuestVerificationModule provides a fail-closed CREATE_REQUEST OTP verification service.
It deliberately has **no public controller**. The service validates UUID/code input,
requires a configured 32-byte HMAC key, and delegates to the atomic PostgreSQL
repository, which consumes a correct challenge once and counts incorrect attempts.

No OTP, recipient or capability is logged by this service. A missing secret fails
closed and a wrong, expired, exhausted or nonexistent challenge gets the same error.

## Gates before any public HTTP route

- Durable OTP issuance with per-recipient, network and global budgets.
- Approved KZ-resident SMS/email provider and delivery-failure reconciliation.
- Web same-origin BFF with CSRF/Origin controls and HttpOnly request-scoped session.
- Rate limits, negative PostgreSQL tests, browser E2E and abuse review.
- Never return a raw capability into browser JavaScript storage.

This module is a backend foundation, not a live guest flow.
