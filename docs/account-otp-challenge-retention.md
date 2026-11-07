# Account OTP challenge retention and private maintenance

## Stage 1 — bounded expired proof deletion

`pruneAccountOtpChallenges` deletes at most **500** `account_auth_challenges` rows per invocation, and only those with `expires_at` more than **25 hours** in the past. This conservative operational cleanup window is a provisional implementation default, not a final legal retention policy. Row selection is ordered, uses `FOR UPDATE SKIP LOCKED`, and cannot block active issuance or verification locks. It handles accepted, consumed and unconfirmed challenges uniformly according to expiry; it never removes currently redeemable OTPs. It does not read or return decrypted contact information.

## Stage 2 — disabled-by-default maintenance

`scripts/prune-account-otp-challenges.ts` requires `SERVICES_ENABLE_ACCOUNT_CHALLENGE_CLEANUP=enabled`, a configured `DATABASE_URL`, and an explicitly approved scheduler. One invocation deletes at most one batch. Database connection and statement timeouts are bounded and logs disclose only row counts. Do **not** invoke this on API startup, as a public endpoint or from OTP issuance, and never expose a user-supplied cleanup timestamp.

Example approved operator command (in the appropriate private deployment environment):

```sh
SERVICES_ENABLE_ACCOUNT_CHALLENGE_CLEANUP=enabled npx tsx scripts/prune-account-otp-challenges.ts
```

## Stage 3 — real PostgreSQL coverage and launch review

Tests prove expiry-only deletion, retention of recent OTP proofs regardless of delivery confirmation/consumption, batch limit and concurrency-friendly lock skipping, and invalid-clock/count rejection.

Before enabling this job in production, confirm retention requirements with the privacy/compliance owner, the incident/audit retention split, KZ residency, restore/runbook, and actual scheduler frequency. Account `contact_cipher`, `contact_digest` and `code_hash` are removed when a challenge is deleted; if legal hold or separate audit retention is required, that must be provided by a specifically reviewed privacy-safe audit store, **not** by indefinitely retaining OTP proofs. This change does not implement SMS/e-mail delivery, public account login or mobile refresh rotation.
