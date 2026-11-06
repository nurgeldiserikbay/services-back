# Account OTP verification — internal, not live login

Three incremental implementation stages:

1. **Account-specific OTP proof.** `account-otp-proof.ts` generates uniformly random six-digit challenges and HMAC-SHA256 code hashes with an explicit `services-account-otp:v1` domain and a challenge ID plus SIGN_IN/SIGN_UP purpose. It requires an independent 32-byte secret. This proof is **not compatible** with the guest OTP scheme.
2. **Atomic one-time verification.** `consumeAccountOtpChallenge` runs inside a caller-owned PostgreSQL transaction. It locks the single challenge row with `FOR UPDATE`, checks channel, purpose, expiry, consumed marker and five-attempt budget, and increments the persisted attempt counter even for an incorrect six-digit code. A correct code is consumed exactly once. Invalid/replayed/expired attempts return null. **The calling transaction MUST COMMIT on failed verification** rather than throwing an error that rolls back the attempt increment.
3. **Real PostgreSQL tests.** Coverage includes purpose/challenge binding, wrong-purpose denial, consumption/replay, five wrong guesses, expiry, missing IDs and no-SQL rejection of malformed input.

**Not shipped as a public authentication flow.** No HTTP routes or account session issuer are added. The verified contact digest is only an internal narrow receipt, NOT authenticated account identity or permission to create a session. To implement real SIGN_IN the server must resolve a matching *active* registered user with verified contact via a reviewed, privacy-safe mapping; SIGN_UP additionally requires explicit signup intent and current Terms/Privacy consent. Protect issuance with provider delivery, rate limits by contact/device/network, anti-enumeration, 5-minute expiry and security audit. Only then may an authenticated account session be minted and delivered through the web HttpOnly BFF / mobile secure-storage boundary. Never treat guest OTP as registered-account login.

The caller must ensure a single transaction, separate secret management/rotation, and anti-enumeration error semantics. Do not mount this helper or return its proof over a public API without completing the above gates. Canonical policy: Services ADR-0005.

## CI regression note (2026-11-06)

The initial PR test incorrectly moved `expires_at` before `created_at`, violating the real PostgreSQL constraint `account_auth_challenge_attempts` (which requires `expires_at > created_at`). The expired-challenge fixture now shifts **both** timestamps into the past, keeping `created_at < expires_at < now()`. A separate test asserts wrong-channel isolation, persisted failed-attempt count and subsequent single-use success. These tests deliberately use PostgreSQL constraints instead of mocking the storage layer.
