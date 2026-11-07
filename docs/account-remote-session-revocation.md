# Account remote session revocation — bearer-only API

Three stages:

1. **Authenticated session removal.** The server adds `DELETE /v1/auth/sessions/:id` using a strict opaque account bearer. It does not accept cookies, user IDs, token hashes, or family IDs. It validates an RFC-style UUID and returns HTTP 204 with `Cache-Control: no-store` on requests made by a valid account session, even when the target is missing or belongs to another user. This avoids leaking another account's sessions. Malformed bearer returns 401; invalid UUID returns 400.
2. **One transaction and SQL ownership.** The controller delegates to `AccountBearerSessionService.revokeSession`, which validates the live ACTIVE actor and calls `revokeMyAccountSessionById` in the same PostgreSQL transaction. The mutation is constrained by the verified user ID, valid expiry and non-revoked state. Revoking the current session is allowed, and further uses of it fail authentication; other sessions of the same account remain active. No account-wide session wipe is introduced.
3. **PostgreSQL regression.** Tests cover one user's current/sibling sessions, foreign session isolation, nonexistent targets, idempotent repeat, self-revoke, post-revoke 401, strict inputs, and non-secret session listing.

## Deployment and client integration

This endpoint is for native app or trusted server-to-server bearer use only. Browsers must use a separate same-origin web BFF with CSRF/Origin checks and existing HttpOnly session cookies; **never** forward a backend bearer to browser JavaScript or localStorage. That BFF and device session UI are not enabled here. The endpoint cannot provide remote confirmation of logout across devices without an authenticated client-side refresh.

Security note: Since 204 also covers unknown/foreign targets, the client must refresh its own authenticated session list to observe whether its intended session was removed. Do not treat a 204 as proof of ownership of a guessed session ID. Account login/provider, signup consent, mobile refresh rotation, KZ provider/data residency and deployed E2E are still outstanding.
