# Atomic internal guest OTP issuance

`GuestChallengeIssuanceService.issueCreateRequest(channel, contact)` is injected
through `GuestVerificationModule`. It is **internal only** and must not be used
from a public HTTP controller until all required security controls are implemented.

In one PostgreSQL transaction it acquires a digest-scoped advisory lock, enforces
per-recipient send quota, stores the recipient encrypted with AES-256-GCM,
stores its keyed HMAC digest, and creates an expiring CREATE_REQUEST challenge
with only a hash of the six-digit OTP. Missing/equal secret keys fail closed.
The returned code and contact are **private delivery material**, never a
browser response or log field.

The challenge remains counted after a delivery failure to prevent budget
refund/retry abuse. No delivery is performed by this service.

## Production gates still open

- KZ-resident approved SMTP/SMS provider with durable delivery tracking and reconciliation.
- Request/network and global budgets, risk checks, verification rate limiting.
- Same-origin BFF with CSRF and Origin protection; HttpOnly request-scoped guest session.
- Idempotent public challenge creation protocol with generic anti-enumeration responses.
- E2E verification of contact -> challenge -> guest request -> seller notifications,
  provider failures and rollback, with monitored limits and redacted telemetry.

Tests cover PostgreSQL at-rest encryption, code hashing and per-recipient
cooldown. A passing CI does **not** make public guest OTP operational.
