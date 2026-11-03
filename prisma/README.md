# Services-back PostgreSQL/Prisma bootstrap

Source of truth: `nurgeldiserikbay/services` G0 contracts, branch `contracts/g0-integrity-2026-11-03` (PR #4). This repo vendors that exact reviewed `schema.prisma`, `constraints.sql`, and `smoke.sql` under `prisma/`; reconcile SHA on each contract change.

The baseline is a **platform-wide schema**, not a geography-only schema. The `services` repository owns contract changes.

## Local / CI database (empty PostgreSQL 16)

1. Configure `DATABASE_URL` to an *isolated, disposable* PostgreSQL 16 database. Do not use real customer data.
2. Install dependencies: `npm install`.
3. Validate schema: `npm run db:validate`.
4. Initialize ephemeral development DB: `npm run db:dev:bootstrap`. The command runs Prisma `db push`, then applies the cross-table/exclusion invariants from `constraints.sql`; it is **only for empty disposable development/CI databases**.
5. Run SQL checks: `npm run db:smoke`, and the starter geo seed: `npm run db:seed:geo`.

Never run `db push` on production or existing customer datasets. Production deployment needs a committed and reviewed baseline migration generated from the pinned Prisma schema, custom invariants included in the *same migration*, a recovery/backup strategy, shadow database rehearsal, and `prisma migrate deploy` from CI/CD. The ephemeral bootstrap does not prove production migration safety.

## Geographic starter seed

`scripts/seed-geography.ts` ships **only** Kazakhstan and three independently known cities (Astana, Almaty, Shymkent) with timezone `Asia/Almaty`. It is an idempotent, transactional *smoke dataset*, NOT a global directory. UUIDs use deterministic namespace-based IDs, names are not changed on conflict, and no personal information is stored.

Full worldwide taxonomy and multilingual names need a separately reviewed source with attribution/licensing, change reconciliation, ISO aliases and city duplicate/disambiguation handling; never infer access to services or geography by IP without user consent.

## Follow-ups before merge/release

- Commit a real Prisma baseline migration and test `migrate deploy` (rather than ephemeral `db push`).
- Verify compatibility between `services` G0 PR #4 and geography OpenAPI PR #5 after both merge.
- Replace geography sample seed with reviewed import pipeline and coverage diagnostics.
- Run true multi-connection concurrency tests and authorization checks.
