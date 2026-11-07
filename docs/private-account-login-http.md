# Trusted BFF account OTP verification — private HTTP gate

## Stage 1 — disabled-by-default session issuance boundary

`POST /v1/auth/private/account/verify` accepts exactly `{challenge_id, channel, code}` and, **only for a verified active registered user**, returns `{session_token, expires_in_seconds}` to an authenticated backend-to-backend client. This route delegates to `AccountOtpSignInService`, which commits failed OTP attempt counts, demands durable provider delivery acknowledgement, consumes the one-time challenge and creates a hashed 12-hour session.

The route is disabled unless `SERVICES_ENABLE_ACCOUNT_LOGIN_HTTP=enabled` AND a separate high-entropy 32-byte base64 `ACCOUNT_LOGIN_BFF_KEY` is configured. The caller supplies the same key in `X-Services-Account-Login-Key`; the backend uses constant-time comparison. An absent/invalid key, missing flag or invalid configuration returns 404 before invoking sign-in. Unknown user, expired/invalid code and consumed challenge all return a generic 401, never account existence or contact.

## Stage 2 — trust and browser boundary

This endpoint is **not a browser login API**. It returns an opaque backend bearer and must only be reachable over TLS from a separately authenticated, allowed trusted BFF. Do not put the service key or bearer in browser JavaScript, URLs, cookie values readable by JS or application logs. Restrict ingress network access, apply request-size/rate budgets and monitoring, and never enable it with an unapproved OTP provider. The existing global CORS excludes browser POST and authorization headers, but CORS **is not** an access control or substitute for ingress restrictions.

This endpoint intentionally does not issue or verify public OTP delivery, and does not create new accounts. A subsequent reviewed frontend same-origin origin/CSRF-protected flow must call it and seal the resulting bearer into a Secure, HttpOnly, SameSite cookie with a short, bounded TTL, while enforcing anti-automation controls.

## Stage 3 — PostgreSQL security regression

Tests verify missing/invalid service key cannot invoke sign-in, flag-disabled requests fail closed, malformed bodies are rejected, unconfirmed OTP is denied, invalid guesses count against stored challenge budget, one provider-confirmed OTP creates one revocable account session and cannot be replayed. Run green typecheck, build, and PostgreSQL tests before release. Public sign-up, real OTP delivery, callback ingress controls, approved KZ data residency and web login are still outstanding.
