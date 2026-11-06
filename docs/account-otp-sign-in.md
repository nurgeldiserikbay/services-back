# Account OTP sign-in to an active database session

## Three internal stages

1. **Verified OTP redemption.** `signInWithVerifiedAccountOtp` consumes only a `SIGN_IN` challenge via the existing transaction-owned one-use OTP verification. A `SIGN_UP` challenge cannot authenticate a registered user. It fails closed on invalid codes, expired/replayed challenges and mismatched channels.
2. **Encrypted contact to ACTIVE account match.** After proof consumption, the same transaction reads the challenge's AES-256-GCM encrypted contact, decrypts it with the configured account-contact key and validates the authenticated ciphertext against the stored purpose-bound contact digest. It performs an exact match on the corresponding `users.email` or `users.phone` and checks `status='ACTIVE'`. A guest identity, a nonexistent account, a suspended account or a signup intent never authorizes account access. No caller-supplied user ID or role is accepted.
3. **Short-lived server session issuance and PostgreSQL tests.** Only a matched ACTIVE user receives a random opaque 256-bit session token, stored as a domain-separated HMAC hash and associated with a new random session family. A 12-hour expiration is persisted. Tests cover successful proof and lookup, replay rejection, unknown and suspended contacts, wrong-purpose/changed-channel codes, and digest tampering.

## Caller contract and mandatory release gates

This helper is **internal-only**: wrap the complete call in `DatabasePool.transaction` and COMMIT even when it returns `null`, otherwise a failed-code attempt or a correctly used unknown-account challenge would be rolled back. This API never sends OTPs and must not be exposed directly in an HTTP route. Never log or return raw token, decrypted contact or OTP except to the trusted session-delivery boundary.

OTP contact ownership does **not** establish legal identity or company authority. User contact enrollment and normalization must be consistently verified: current exact-match semantics intentionally do not perform guessed case-insensitive fallback, merge accounts or promote guest inquiries. A future web BFF must set a secure HttpOnly cookie and enforce CSRF/Origin, while mobile requires a separately reviewed short-lived access and rotating refresh architecture. Public login still needs a delivery provider, trusted network/device quotas, anti-enumeration responses, signup Terms/Privacy consent, revocation/replay audit and comprehensive E2E. This change does not enable those routes.
