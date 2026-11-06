# Account OTP network budget retention

## Three stages

1. **Bounded cleanup** — `pruneAccountOtpNetworkLedger` removes only `account_otp_network_issuances` entries with `created_at` strictly older than 25 hours, preserving the complete rolling 24-hour send budget plus a one-hour safety margin. One invocation deletes up to 500 rows with `FOR UPDATE SKIP LOCKED`, minimizing interference with concurrent OTP issuance and allowing safe maintenance retries.
2. **Disabled-by-default maintenance** — run `npx tsx scripts/prune-account-otp-network.ts` only from an approved scheduled maintenance job with `SERVICES_ENABLE_ACCOUNT_NETWORK_CLEANUP=enabled` and `DATABASE_URL` configured. Run a bounded batch per invocation; schedule additional batches if necessary. Logging is limited to aggregate deleted row count, never a digest or OTP.
3. **PostgreSQL regression tests** — assert 25-hour cutoff, bounded CTE, invalid time/count failure, real DB cleanup of 26h-old rows and retention of 24.5h/23h rows. Test work is rolled back.

## Security and deployment

PR #53 is already merged into main. PRs #54 and #55 were merged only into feature branches; this consolidated PR targets main and includes both changes. Neither the account OTP endpoints nor an approved SMS/e-mail provider are added here.

The maintenance task must not be exposed as an HTTP route or invoked from API startup. Use an approved database credential with narrow maintenance permissions. Schedule retention with monitoring and operator approval. This ledger stores only signed-ingress-derived keyed network digests, not raw IPs, contacts, OTPs or account tokens. Network/device quotas, anti-enumeration, provider security and real registered-account sign-in/session issuance are still production release gates.

See `docs/account-otp-network-budget.md` and canonical ADR-0005.
