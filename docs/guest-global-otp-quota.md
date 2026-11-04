# Global guest OTP issuance budget

The internal `GuestChallengeIssuanceService` now checks **two independent
transactional budgets** before inserting a CREATE_REQUEST challenge:

1. Global: at most **30/minute, 300/hour, 3000/day** across all API
   processes using the same PostgreSQL database.
2. Per-recipient: 60-second cooldown, 3/hour and 8/day, keyed by a contact HMAC.

Every issuance locks the *global* PostgreSQL advisory key before the
*contact* advisory key, then inserts the challenge **in the same transaction**.
This guarantees two concurrent issuers cannot both pass a full global bucket.
An OTP delivery failure remains counted in both budgets; no quota refund.
The quota result is internal only; public anti-enumeration responses are
not implemented.

## Important remaining launch gates

- Network/IP-context and device abuse quotas with appropriately protected,
  short-retained network identifiers. Do not store guest IPs in a public
  searchable table or expose them in logs.
- Reviewed, Kazakhstan-resident SMS/email delivery provider and delivery
  reconciliation, platform-wide provider spend controls and monitoring.
- BFF with Origin/CSRF, HttpOnly guest proof session, idempotency and end-to-end
  negative tests.
- **Performance review before scaling:** this MVP global query counts
  guest_challenges over the most recent 24 hours. The current Prisma
  baseline does not index (purpose,created_at). Benchmark against staging
  dataset size and add an indexed/bucket-counter migration before
  high-volume release. Do not remove the PostgreSQL lock without an
  equivalently atomic distributed limiter.
- Admin-safe alerts for exhausted budgets, without exposing recipient
  addresses, OTPs, IPs or secrets.

The global quota is a defense-in-depth building block; it **does not**
authorize exposing any guest OTP or request HTTP endpoint.

Tests cover rate tiers and a PostgreSQL burst hitting the minute threshold.
