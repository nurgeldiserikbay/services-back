# Bearer-only account sessions HTTP bridge

## Stage 1 — account session inventory

`GET /v1/auth/sessions` accepts exactly one `Authorization: Bearer <43-character opaque session token>`. It authenticates an ACTIVE account session within a PostgreSQL transaction and returns `{items:[]}` with at most 50 of that account's active sessions, current session first. Returned fields: `id`, `deviceLabel`, `lastUsedAt`, `expiresAt`, `current`. Neither raw bearer, token HMAC, family ID nor private user contact is returned. Unauthenticated requests receive 401 and private no-store cache headers.

## Stage 2 — current-session logout

`POST /v1/auth/logout` accepts the same bearer-only authorization and returns HTTP 204 on successful revocation. Its verified user and session are derived from the bearer, not request body. A revoked/expired/invalid bearer returns 401 and cannot revoke someone else's session. PostgreSQL verification and revocation use one transaction connection. Logout in a web UI must also clear the **web BFF's** HttpOnly cookie independently; this backend API neither reads nor clears cookies.

## Stage 3 — transport and PostgreSQL integration tests

Tests cover rejected cookie-only/Basic/malformed/multiple credentials, valid header, safe session listing, current-session invalidation, replay denial, and isolation of a foreign user's session. The backend global CORS policy deliberately does not grant browser Authorization or POST. Do not relax it to make direct browser calls work.

## Deliberately excluded

These routes do **not** issue tokens or implement account login/signup. The existing OTP account sign-in helper is still internal. Do not expose `POST /auth/challenges` or `verify` until an approved OTP provider, anti-enumeration, signup consent, trusted ingress/device budget, safe session delivery, account recovery and audit/E2E gates are met. For web login use a separately CSRF/Origin-protected same-origin BFF with Secure HttpOnly __Host- cookie. For native clients design refresh-token rotation/replay detection before live use. Remote-session revoke and all-devices logout remain internal until step-up/MFA policy is reviewed.

Policy: Services ADR-0005. This PR provides a narrow session-management HTTP bridge only.
