# Guest contact OTP send quota (internal, not enabled)

This module checks a HMAC'd recipient digest against the existing guest_challenges table. It uses a transaction-scoped advisory lock, a one-minute cooldown, three challenges per hour and eight per day for that digest. **Caller MUST insert the challenge under the same transaction and lock** or the quota can be bypassed by concurrent issuers. No SMS/email is sent, no debug OTP or raw recipient is exposed, and no public route is registered.

These figures are provisional safety ceilings, not an accepted final anti-abuse policy. Limits must be reviewed for legitimate retries, accessibility and geography before launch.

This check alone is **insufficient** for production. The public issuance route still needs IP/network/ASN rate limits, global delivery budgets, CAPTCHA or adaptive friction as appropriate, suppression lists, provider reconciliation, enumeration-safe failures, privacy-safe metrics, account recovery threat modeling and operational monitoring. Avoid using an in-memory counter in multi-instance deployment. The worker must handle retries without generating an unbounded number of new challenges.

Real PostgreSQL integration tests validate empty, cooldown and hourly quota cases. This module is deliberately separate from HTTP controllers.
