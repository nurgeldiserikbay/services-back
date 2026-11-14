# Services Backend

NestJS and TypeScript backend for the global Services platform. Canonical product decisions, public API contract and database reference schema live in [services](https://github.com/nurgeldiserikbay/services). Contract reconciliation is under [services PR #4](https://github.com/nurgeldiserikbay/services/pull/4).

## Verified CI baseline (2026-11-10)

GitHub Actions [run 42833641292](https://github.com/nurgeldiserikbay/services-back/actions/runs/42833641292) succeeded on commit `b2c43b16aa4e2d0d3693de1a2f212aca6d829aee`. The `build-and-test` job passed TypeScript typecheck, build, Prisma model validation, migration baseline drift check, migration deploy twice and status, idempotent geography seeding, PostgreSQL smoke/table checks, and unit/integration tests. The independent production dependency audit job also passed. This verifies the CI environment only; it does **not** certify production deployment, live secrets, backups, data residency, performance or real customer journeys.

**Migration release caution:** the historical `20261110_platform_admin_foundation` migration was corrected after duplicate table DDL blocked clean installs. Before applying to any persistent database, inspect `_prisma_migrations` and reconcile checksums/history if that migration was already recorded there. Never blindly reset or delete a production database.

**Release gates still outstanding:** staging deployment and rollback rehearsal; backup/restore test; production environment and secrets review; cross-repository API contract/E2E verification; observability and load testing; documented security sign-off.

## Verified code inventory (2026-11-07)

The earlier scaffold-only status below is historical and **must not** be used as the current feature inventory. Current `src/modules/app.module.ts` imports CatalogModule, GeographyModule, PublicOfferModule, SellerInboxModule, SellerDecisionHttpModule, GuestVerificationModule and AccountBearerSessionModule, in addition to DatabaseModule and health. The catalog controller exposes `GET /v1/search`; public profile routes include `GET /v1/professionals/:slug` and `GET /v1/organizations/:id`.

**Current pagination:** catalog search accepts a bounded decimal `cursor` offset and returns up to 50 items plus `next_cursor` when another page exists. This is offset pagination (not stable keyset pagination under concurrent catalog changes); it is limited to 10,000 skipped rows. Future work: keyset cursor and integration verification. A module's presence does not establish that its complete business journey, database migrations, end-to-end tests or production deployment is verified.

Regression tests: `test/search-contract-regression.test.ts` and `test/catalog-repository-regression.test.ts` (added, execution/CI status not yet confirmed). Run `npm run typecheck && npm run build && npm test` before treating these as passing.

## Historical scaffold notes (superseded by inventory above)

## Initial foundation at scaffold stage

- NestJS 12 runtime with `/v1/health` health check.
- Restrictive CORS allowlist (no credentialed wildcard), port validation and environment template.
- TypeScript strict compilation, configuration tests and GitHub Actions CI.
- No real catalog/search, accounts, OTP, requests or database integration yet. Do not present health as database readiness.

## Local development

Use Node.js 22.12+ and npm:

```bash
npm install
cp .env.example .env
npm run dev
# GET http://127.0.0.1:3001/v1/health
```

Run `npm run typecheck && npm run build && npm test` before PR review.

## Parallel development boundaries

Backend owns all authorization, policies, write transactions, SQL migrations, outbox and data residency. Frontend consumes reviewed OpenAPI only and never determines permission from client state. Keep contract revisions in the documentation repository first.

Next backend vertical slices: country/city/taxonomy, public published catalog, then identity and request workflows. Use real database migrations and transactional tests, not in-memory fake persistence. Do not merge this PR without reviewer approval.


## Privileged admin session issuance foundation (2026-11-11)

`src/modules/admin/admin-session-issuance.ts` provides
`createVerifiedPlatformAdminSession(db, verified, pepper, now)`.
It is a **server-only persistence primitive**, not an authentication route.
A trusted, independent MFA/login service must first authenticate the staff
member, verify the second factor, and supply the authoritative staff UUID and
verification timestamp. Never accept either value from an untrusted browser
payload. The caller must use `DatabasePool.transaction` and only release the
bearer after the transaction commits successfully.

The insertion checks live staff status, active account status and the
presence of at least one explicit grant. The session lasts 15 minutes;
only a domain-separated HMAC hash of its random bearer is persisted.
Backend resource APIs must still independently revalidate session,
revocation, MFA freshness, role and exact resource scope on every request.
A grant alone does not imply permission for all scopes.

Before exposing login, implement a dedicated MFA challenge lifecycle,
attempt limits, replay prevention, privileged identity provisioning and
recovery controls, then end-to-end tests against migrated PostgreSQL.
No public admin login or token-issuing HTTP endpoint is enabled by this
change. The implementation is **not production-ready**.


## Backend completion gates (release checklist)

A successful unit-test run is necessary but not sufficient to declare the backend finished. Record a commit SHA, environment, operator and evidence link for each gate.

- [ ] **Current commit CI:** confirm both `build-and-test` and `dependency-audit` pass on the exact release SHA, including the privileged-session issuance regressions.
- [ ] **Persistent-database migration safety:** inspect `_prisma_migrations` and migration checksums in staging before `prisma migrate deploy`; never reset a database to resolve history drift.
- [ ] **Identity and authorization:** verify account sessions, guest OTP ingress, seller ownership, privileged role/scope grants, MFA freshness, revocation and cross-account isolation against migrated PostgreSQL.
- [ ] **Full request lifecycle:** execute guest request → seller accept/decline → status → notification, including cancellation windows, retries, concurrency and timezone boundaries.
- [ ] **Admin release gate:** keep privileged login and browser session issuance disabled until trusted MFA challenge, replay prevention, recovery, throttling and end-to-end issuance are verified. A server-only issuance primitive is not a login endpoint.
- [ ] **Operations:** staging HTTPS smoke tests, KZ residency and secrets review, redacted logging, alerting, backup/restore rehearsal, rollback and load testing.
- [ ] **Cross-repository contract:** verify the frontend release SHA against the backend release SHA, not only the frontend CI's default pinned backend baseline.

Only mark the backend production-ready after all applicable gates have evidence and a documented sign-off. This checklist does not itself certify any gate.
