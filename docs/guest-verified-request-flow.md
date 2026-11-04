# Verified guest request application flow

The `GuestVerifiedRequestFlow` is an **internal NestJS-only** use case.
It checks an OTP using `GuestChallengeVerificationService` (single-use
challenge -> scoped CREATE_REQUEST capability), then invokes the existing
`GuestRequestService.createFromVerifiedContact` (atomic request, seller
routing, event, notification intent and encrypted idempotency reply).

The service does not add any public endpoint, send SMS/email, create
accounts for guests, or enable browsers to receive capability tokens.
It relies on the existing PostgreSQL transaction/integration tests, and adds
unit tests covering orchestration, invalid OTP and create failures.

## Important retry boundary

Verification consumes the challenge independently of request creation.
If request creation fails after verification, repeating `verifyAndCreate`
with the same OTP will not succeed. A production same-origin BFF must keep
the issued CREATE_REQUEST capability **server-side in a scoped HttpOnly
session**, and retry only the create step with the same Idempotency-Key.
Do not store raw capabilities in browser JavaScript, URLs, logs or analytics.

## Release blockers

- Production-approved Kazakhstan-region SMS/email provider and reconciliation.
- Global, network and recipient OTP budgets plus verification throttling.
- Secure BFF session issuance, CSRF and Origin enforcement, rate limits.
- Negative authorization and concurrency integration tests, end-to-end
  staging tests and notifications delivery confirmation.

This is an application composition layer, not a working public checkout.
