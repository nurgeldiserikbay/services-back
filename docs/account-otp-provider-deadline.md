# Account OTP provider acceptance deadline

## Stage 1 — bounded private delivery

Registered-account `AccountOtpDispatchService` now waits at most **8 seconds** for an approved in-process SMS/email provider's `deliver()` acceptance. It uses a small standalone `deliverAccountOtpWithinDeadline` helper. A provider never answering cannot hang the OTP request indefinitely. Timeout is treated exactly like other provider failures: a generic service-unavailable outcome, no raw provider errors or contact details returned.

## Stage 2 — committed challenge fails closed

A timeout triggers existing compensation: mark the committed `account_auth_challenges` record consumed. The delivery confirmation column is **not set**, so a code that a provider eventually sends cannot create a valid session. Global/network/contact issuance limits are charged and are not refunded. The independent five-minute challenge expiry remains a backup. This is an availability tradeoff: a code might arrive after timeout and be unusable; clients should retry under budgets, not try to recover a secret.

**Important:** a promise deadline does not cancel SMS/email delivery at the provider. Actual adapters must enforce outbound network timeout and cancellation themselves, including their own idempotent request handling. Do not reuse a timed-out challenge or manually set `delivery_confirmed_at`.

## Stage 3 — regression and rollout

Unit tests cover prompt provider success, hung delivery deadline, late success rejection and invalid timeout parameters. PostgreSQL regression covers a timed-out provider leaving the challenge consumed, delivery unconfirmed and issuance quota retained; late provider acceptance does not alter the database proof.

The default provider remains disabled. No real SMS/email vendor, account registration endpoint, browser bearer or production secrets are configured here. Before enabling, vet a Kazakhstan-compliant provider and residency policy, monitor timeout counts without PII, enforce network egress timeouts, and run backend and browser E2E across real provider responses.
