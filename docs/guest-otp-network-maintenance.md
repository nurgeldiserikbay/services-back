# Network OTP quota ledger maintenance

The privacy-preserving network quota ledger holds keyed network digests
rather than raw IPs. These records must not be kept indefinitely.

## Explicit maintenance operation

`npm run db:prune:guest-network`

The command **fails closed** unless
`SERVICES_ENABLE_GUEST_NETWORK_CLEANUP=enabled` and `DATABASE_URL`
are set. Run from a reviewed, isolated Kazakhstan-resident maintenance
worker or scheduled job with restricted database credentials. This
change does **not** install a scheduler or run on API startup.

Each invocation deletes **at most 500** rows where
`created_at < now - 25 hours`. The quota path counts only the last
24 hours. The extra hour ensures active quota rows never disappear
prematurely. A `FOR UPDATE SKIP LOCKED` subquery prevents concurrent
maintenance workers from contending for the same rows; deletion uses
a single atomic PostgreSQL statement. Repeated invocations can drain
a backlog, while batch limits protect the database.

Only aggregate deleted-row counts are printed. Never emit network
digests, raw addresses, OTPs or contacts to logs. Monitor backlog size
and execution failures without printing row identifiers.

The new implementation has unit and real PostgreSQL rollback-based
tests for old, boundary and active rows, invalid inputs, atomic
deletion and repeated invocation.

## Still required before production launch

- Approved job scheduler/operational cadence and alerting.
- Restricted database permissions and explicit retention approval.
- Trusted ingress signing and end-to-end verification of proxy trust.
- KZ-resident OTP provider, provider spend limits and browser BFF
  CSRF/Origin protections.
- Load/concurrency testing and full guest request/cancellation E2E.

The guest OTP endpoint remains disabled by default.
