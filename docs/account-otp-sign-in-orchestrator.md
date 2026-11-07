# Account OTP sign-in transaction orchestration — private boundary

This change completes three internal backend stages without enabling a public account login endpoint.

## 1. Transaction-owned sign-in

`AccountOtpSignInService` validates the challenge UUID, exact EMAIL/SMS channel and 6-digit code before database access. It loads separate environment-configured OTP HMAC, contact digest, AES-GCM encryption and account-session HMAC secrets. It invokes the existing `signInWithVerifiedAccountOtp` helper through a single `DatabasePool.transaction` boundary.

The underlying helper requires a provider-confirmed, one-time SIGN_IN OTP and an exact ACTIVE registered contact match before issuing a 12-hour hashed opaque account session. It does not create an account, infer company permissions or promote a guest OTP.

## 2. Failure semantics and replay protection

Expected authentication failures return `null` rather than throwing. The transaction therefore **commits wrong-code counters** and consumption for correctly verified but unknown or suspended accounts. The internal caller must not wrap `null` as a rollback-triggering exception. Database/secret failures raise a generic `ServiceUnavailableException` without exposing private diagnostics. The raw session token is returned only to a trusted server caller; it must not be logged, placed in URLs or directly exposed to browser JavaScript.

No HTTP login controller or cookie issuer is registered here.

## 3. Real PostgreSQL verification

New tests cover delivery-confirmed OTP sign-in to an ACTIVE user, one-time proof and session count, unconfirmed challenge rejection, persistent wrong-code attempt counters, unknown-account consumption, input prevalidation and sanitized database failure.

## Production gates

Account OTP delivery remains disabled without an approved provider. Future public routes require trusted ingress and device controls, abuse rate limits, non-enumerating responses, contact enrollment and consent for signup, CSRF/Origin-protected same-origin web BFF, secure HttpOnly cookie issuance, mobile rotating refresh credentials, logs/audit, and full E2E. Completing a transaction does not itself make this a production-ready account login.

Canonical authority: Services ADR-0005 and related registered-account authentication contracts.
