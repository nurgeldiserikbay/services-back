# Services-back PostgreSQL/Prisma bootstrap

Source of truth: `nurgeldiserikbay/services` G0 contracts, branch `contracts/g0-integrity-2026-11-03` (PR #4). This repo vendors that exact reviewed `schema.prisma`, `constraints.sql`, and `smoke.sql` under `prisma/`; reconcile SHA on each contract change.

The baseline is a **platform-wide schema**, not a geography-only schema. The `services` repository owns contract changes.

## Committed initial migration and integration checks

The checked-in migration `prisma/migrations/20261103_initial_platform/migration.sql` contains **42 platform tables** plus the reviewed G0 SQL guards. It is generated with Prisma 6.19.0 and pinned in the repository. CI regenerates the SQL and rejects any drift against the committed migration, then applies it to an empty PostgreSQL 16 database using `prisma migrate deploy`.

The migration must **never** be regenerated or edited after production deployment; future schema changes require new incremental migrations, not editing the initial migration. This work was tested against an empty CI database only: production upgrade, backfill, locks, rollback strategy and real data residency still need explicit deployment review.

## Local / CI database (empty PostgreSQL 16)

1. Configure `DATABASE_URL` to an isolated, disposable PostgreSQL 16 database. Never use real customer data for smoke tests.
2. Install dependencies: `npm install`.
3. Validate the schema: `npm run db:validate`.
4. Deploy committed migration: `npm run db:migrate`. **Do not** run the generator on an already deployed production migration.
5. Seed the curated geo starter: `npm run db:seed:geo` (safe to run again).
6. Run constraints and integration tests: `npm run db:smoke && npm test`.

For production, add backup/recovery rehearsal, migration rehearsal on representative redacted data, role separation and approved change window before enabling any country.

## Geographic starter seed

`scripts/seed-geography.ts` ships **only** Kazakhstan and three independently known cities (Astana, Almaty, Shymkent) with timezone `Asia/Almaty`. It is an idempotent, transactional *smoke dataset*, NOT a global directory. UUIDs use deterministic namespace-based IDs, names are not changed on conflict, and no personal information is stored.

Full worldwide taxonomy and multilingual names need a separately reviewed source with attribution/licensing, change reconciliation, ISO aliases and city duplicate/disambiguation handling; never infer access to services or geography by IP without user consent.

## Follow-ups before merge/release

- Review baseline migration and custom SQL guards for production rollouts, test incremental migration strategy and migration lock contention.
- Verify compatibility between `services` G0 PR #4 and geography OpenAPI PR #5 after both merge.
- Replace geography sample seed with reviewed import pipeline and coverage diagnostics.
- Run true multi-connection concurrency tests and authorization checks.
