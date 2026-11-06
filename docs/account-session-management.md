# Authenticated account session management — internal boundaries

Three incremental stages extending the merged PR #57 sign-in proof:

1. **Bounded session inventory.** `listMyAccountSessions` authenticates the caller via the existing active-session proof, then lists up to 50 active sessions belonging to that user's account. The current session sorts first, followed by expiration and ID for deterministic ordering. The returned DTO includes only session ID, optional device label, last-used timestamp, expiration and `current` flag. It NEVER includes bearer tokens, token hashes, session family IDs, contacts or other private account fields.
2. **Single device revocation.** `revokeMyAccountSessionById` verifies the caller's active session first, validates the target UUID, and revokes only a row with both `id=target` AND `user_id=authenticated actor`. A foreign, unknown, expired or previously revoked target returns false. The caller may also revoke the current session, after which its proof is invalid. This does not impersonate family-wide or privileged logout-all.
3. **Real PostgreSQL tests.** Test owner/foreign session isolation, safe DTO fields, repeat rejection, self revocation, revoked proof, expiry and suspended-account fail-closed behavior. These use rollback-only real database transactions.

## Required integration gates

The functions are intentionally INTERNAL. They must be called with a single transaction client (e.g., `DatabasePool.transaction`) for authentication and mutation. Do not trust a browser-supplied account ID. The web BFF must independently authenticate its cookie and CSRF/Origin for mutations and clear its own cookie when the current session is revoked. A UI exposing individual remote-session revocation should apply appropriate reauthentication/step-up and audit policy before production. Return uniform not-found/not-owned behavior and never reveal foreign existence. No public session-management endpoint has been mounted.

This is NOT a mobile rotating refresh implementation and does not enable OTP delivery, user self-signup, or production login. The verified account OTP sign-in core from PR #57 remains internal until delivery, anti-enumeration, secure cookies, CSRF, session lifecycle, recovery and E2E are finished. Canonical authority: Services ADR-0005.
