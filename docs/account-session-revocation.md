# Backend account session revocation — internal boundary

## Stage 1: current-session logout

`revokeCurrentAccountSession(db, opaqueToken, pepper)` verifies the token using the existing v1 HMAC session proof and checks active user, expiry and revocation. It then updates only the authenticated session row. The public caller cannot supply `user_id` or `session_id` as a deletion target.

## Stage 2: same-family revocation

`revokeCurrentAccountSessionFamily(db, opaqueToken, pepper)` verifies the same active actor, reads its family from the database and revokes **only that authenticated user's sessions belonging to the actor's family**. Another family of the same account and another user's sessions with a matching family ID are excluded by explicit SQL constraints.

Both functions require **the same PostgreSQL transaction connection** for validation and mutation; callers must wrap them in an explicit transaction. They return false/0 for invalid, expired or revoked proof, without disclosing the account or session's existence. No raw tokens, hashes, IP addresses or contacts are logged.

## Stage 3: PostgreSQL security tests

Integration tests cover session isolation, sibling revocation, unrelated family and unrelated user, duplicate invocation, expired token and suspended account. This is not a fake in-memory database test.

## Important integration gates

No public login/logout API was created in this PR. Verified account sign-in/sign-up OTP, backend account session issuance, rate limiting, device binding strategy, high-assurance logout-all/step-up, family refresh rotation and replay detection, audit, cookies/CSRF in same-origin BFF, and end-to-end tests are separate gated work. Do not treat guest OTP as account login or leak bearer in browser storage. Source of truth: Services ADR-0005.

The session token revocation changes backend state, but the web BFF must ALSO clear its own HttpOnly session cookie on logout. Revoke authenticated backend proof first, clear cookie even on upstream failure, and define explicit semantics for ambiguous network failures. Do not automatically use family revocation as a user-visible logout-all without a step-up policy.
