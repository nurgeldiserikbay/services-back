# Initial Prisma baseline vs forward migrations

The initial `20261103_initial_platform` migration is immutable once deployed. The earlier generator mistakenly diffed the evolving `prisma/schema.prisma` against an empty database. The new account OTP `delivery_confirmed_at` column (added by a reviewed forward migration) therefore caused CI to attempt a forbidden historical baseline rewrite.

## Stage 1 — immutable historical snapshot

`prisma/baseline.schema.prisma` is an exact copy of the pre-delivery-confirmation model. `scripts/generate-baseline.mjs` uses only this snapshot to recompute the original SQL plus `prisma/constraints.sql`. The generated historical SQL and migration lock file must remain byte-for-byte stable.

## Stage 2 — forward-only schema evolution

Keep `prisma/schema.prisma` as the current model and evolve it only alongside new timestamped SQL migrations. The `20261107_account_otp_delivery_confirmation` migration adds the new nullable column. NEVER silently add columns to the 20261103 initial migration or re-run initial migration against an existing DB.

## Stage 3 — CI/release gate

`test/baseline-schema-pin.test.ts` verifies the frozen model excludes delivery confirmation, current model includes it and the forward migration explicitly adds it. CI's existing `npm run db:baseline:generate` and `git diff --exit-code` must pass, followed by `npm run db:migrate`, PostgreSQL smoke, typecheck, build and tests.

The initial snapshot is an historical artifact and must not be edited for future feature work. For future schema updates add a forward migration and validate real database upgrades. Do not claim production readiness from passing CI alone.
