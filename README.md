# Services Backend

NestJS and TypeScript backend for the global Services platform. Canonical product decisions, public API contract and database reference schema live in [services](https://github.com/nurgeldiserikbay/services). Contract reconciliation is under [services PR #4](https://github.com/nurgeldiserikbay/services/pull/4).

## Verified code inventory (2026-11-07)

The earlier scaffold-only status below is historical and **must not** be used as the current feature inventory. Current `src/modules/app.module.ts` imports CatalogModule, GeographyModule, PublicOfferModule, SellerInboxModule, SellerDecisionHttpModule, GuestVerificationModule and AccountBearerSessionModule, in addition to DatabaseModule and health. The catalog controller exposes `GET /v1/search`; public profile routes include `GET /v1/professionals/:slug` and `GET /v1/organizations/:id`.

**Known limitation:** catalog search currently returns up to 50 items and `next_cursor: null`; real cursor pagination is not implemented. A module's presence does not establish that its complete business journey, database migrations, end-to-end tests or production deployment is verified.

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
