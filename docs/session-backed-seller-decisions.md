# Session-backed seller decision internal boundary

Adds an internal transaction service that resolves the authenticated user from a **hash-stored, 256-bit opaque account session token** and verifies an ACTIVE account, unexpired and unrevoked session, immutable request seller ownership, and company membership before accept/decline. The token hash is HMAC-SHA256 with a purpose-specific 32-byte `ACCOUNT_SESSION_HMAC_KEY`; it is not interchangeable with guest challenge/capability proofs. No raw token is logged or stored.

**Not a login implementation.** The issuer must use the exact v1 hash scheme, create sessions only after strong account verification, and manage login/session rotation, revocation, expiry, MFA as needed, rate limiting and device security. Browser webSession uses an HttpOnly Secure same-site cookie through a BFF with Origin/CSRF protection; a native bearer uses secure storage. This branch deliberately registers NO public routes.

The internal service resolves the active session, seller authority and state transition within one PostgreSQL transaction. All previously implemented authorizations and notification intents are preserved. PostgreSQL integration tests cover active, revoked, expired and suspended sessions. No guest OTP automatically becomes a registered account session.

Next release gates: authenticated session issuance and lifecycle, BFF, request-scoped idempotency keys, audit, seller inbox ACL and cross-process concurrency tests.
