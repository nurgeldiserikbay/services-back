# Services Backend

NestJS and TypeScript backend for the global Services platform. Canonical product decisions, public API contract and database reference schema live in [services](https://github.com/nurgeldiserikbay/services). Contract reconciliation is under [services PR #4](https://github.com/nurgeldiserikbay/services/pull/4).

## Current implemented foundation

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
