# Seller inbox / decision authority parity

This patch closes a discrepancy between the private seller inbox and the request decision authorization gate.

## Stage 1 — personal seller status parity

The personal seller inbox now requires a `PUBLISHED` professional profile in addition to the canonical ACTIVE user and person ownership. The seller decision authority already enforced this rule. Paused, draft and archived professional profiles must not appear as actionable requests when the same owner would be denied the accept/decline mutation. Organization seller authorization remains unchanged: ACTIVE organization, ACTIVE account, OWNER/ADMIN membership, valid scope, no revoked membership. Neither an offer price nor a confirmed calendar time is implied by inbox visibility.

## Stage 2 — lifecycle and privacy integration tests

Real PostgreSQL tests exercise published -> paused -> draft -> archived -> published transitions, ensuring read and write permissions agree. They also verify suspended accounts are denied and no guest contact or private request note leaks to the public-safe inbox response. Tests run in rollback transactions.

## Stage 3 — contract and release guidance

No new endpoint, DTO, privilege or authentication method is introduced. This restricts what is shown for inactive professional profiles and may intentionally hide pending requests until profile re-publication; product/UX owners should determine whether an explicitly read-only historic view is needed. Any future read-only history must have a separate reviewed contract and ACL, never silently broaden decision authority. Keep both seller inbox and decision tests in CI.

This is a backend safety/consistency patch, NOT a completed login-provider or customer-to-seller browser E2E rollout.
