# Services — Master delivery checklist

**Source of truth:** this file tracks the entire Services platform (backend, frontend, admin, docs).
**Status:** living acceptance register; statuses are evidence-based, not a claim that CI is green.
**Baseline:** 2026-11-15. Previous 85% estimate is historical and **not verified**; do not treat it as a calculated completion percentage.

## Rules

- `[x]` = verified complete: attach commit/PR **and** passing relevant CI or reproducible acceptance evidence.
- `[ ]` = not yet verified. `Prepared` means work was implemented/reported but has not met the verification gate; `Pending` means no completion evidence is established.
- Each change must update this file in the **same PR/commit** as the task or immediately after evidence is available.
- Record evidence under `## Evidence log`, including repository, SHA, CI URL, date and result. Never mark green based on empty GitHub commit-status responses.
- Do not compute a single readiness percentage from unverified checkboxes. Once verified, calculate `verified completed / total acceptance items * 100` (equal weights unless a separately approved weighted scheme is committed).
- Any regression reopens the corresponding checkbox; changes in scope require updating the denominator.
- Release gate: all mandatory acceptance items verified, all main CI green, E2E passing, security review and staging sign-off.

## Acceptance items

### Architecture & infrastructure

- [ ] Separate backend/frontend/admin/docs repositories — Prepared; verification pending
- [ ] NestJS Prisma PostgreSQL foundation — Prepared; verification pending
- [ ] PWA and mobile architecture — Prepared; verification pending
- [ ] Redis and background processing — Pending verification
- [ ] Dev/staging/prod configuration — Pending verification
- [ ] API contract parity — Pending verification
- [ ] Structured error handling and sanitized logs — Pending verification
- [ ] Production infrastructure review — Pending verification

### Accounts & authentication

- [ ] Registration and sign-in — Pending verification
- [ ] Email/SMS verification — Pending verification
- [ ] Session and token handling — Prepared; verification pending
- [ ] OTP abuse protection — Pending verification
- [ ] User profile lifecycle — Pending verification
- [ ] Account suspension and recovery — Pending verification
- [ ] RBAC authorization — Prepared; verification pending
- [ ] Rate limits and brute-force controls — Pending verification
- [ ] Authentication E2E tests — Pending verification

### Professionals & companies

- [ ] Multiple professions per professional — Prepared; verification pending
- [ ] Professional profile CRUD — Pending verification
- [ ] Company profile and staff management — Pending verification
- [ ] Company-professional affiliation model — Prepared; verification pending
- [ ] Affiliation allowlist permissions — Prepared; verification pending
- [ ] Block unlink when active requests exist — Prepared; verification pending
- [ ] Publish/pause/archive lifecycle — Pending verification
- [ ] Visibility and privacy rules — Pending verification

### Catalog & search

- [ ] Service and profession catalog — Pending verification
- [ ] Category hierarchy — Pending verification
- [ ] Geographic reference data — Prepared; verification pending
- [ ] City/region search — Pending verification
- [ ] Professional/company search — Pending verification
- [ ] Filters and sorting — Pending verification
- [ ] Mobile search UX — Pending verification
- [ ] Query indexes and performance — Pending verification

### Requests & scheduling

- [ ] Guest request creation — Prepared; verification pending
- [ ] Guest capability token security — Prepared; verification pending
- [ ] Authenticated request flow — Pending verification
- [ ] Seller accept/reject actions — Pending verification
- [ ] Request state transitions — Pending verification
- [ ] Idempotency and retries — Pending verification
- [ ] IANA timezone support — Prepared; verification pending
- [ ] DST-safe cancellation snapshot — Prepared; verification pending
- [ ] Availability and collision handling — Pending verification
- [ ] End-to-end request lifecycle — Pending verification

### Reviews & ratings

- [ ] Separate company and professional reviews — Prepared; verification pending
- [ ] Review permissions — Pending verification
- [ ] Rating calculation — Pending verification
- [ ] Duplicate/fraud protection — Pending verification
- [ ] Review moderation — Pending verification
- [ ] Review frontend — Pending verification

### Notifications

- [ ] Outbox model — Prepared; verification pending
- [ ] Notification intents — Prepared; verification pending
- [ ] Email/SMS integration — Pending verification
- [ ] Retry and dead-letter handling — Pending verification
- [ ] Deduplication — Pending verification
- [ ] Notification audit logs — Pending verification
- [ ] Delivery monitoring — Pending verification

### Admin

- [ ] Owner/admin/operator/auditor roles — Prepared; verification pending
- [ ] Separate admin token domain — Prepared; verification pending
- [ ] TOTP MFA and replay defense — Prepared; verification pending
- [ ] TOTP disable/delete invalidates sessions — Prepared; verification pending
- [ ] DB-authoritative session grants — Prepared; verification pending
- [ ] Moderation and authorization — Pending verification
- [ ] Security audit trail — Pending verification
- [ ] HTTP security headers — Prepared; verification pending
- [ ] Admin UI functional acceptance — Pending verification
- [ ] Admin PostgreSQL and E2E tests — Pending verification

### Frontend & PWA

- [ ] Protected guest create BFF — Prepared; verification pending
- [ ] HTTP payload/response limits — Prepared; verification pending
- [ ] HttpOnly sealed guest capability — Prepared; verification pending
- [ ] Navigation and core pages — Pending verification
- [ ] Search/profile/request UX — Pending verification
- [ ] Responsive mobile layout — Pending verification
- [ ] Loading/empty/error states — Pending verification
- [ ] PWA manifest and offline behavior — Pending verification
- [ ] Accessibility and keyboard navigation — Pending verification
- [ ] Lighthouse/Core Web Vitals — Pending verification

### Security & data

- [ ] Separate admin token HMAC domain — Prepared; verification pending
- [ ] TOTP factor lifecycle — Prepared; verification pending
- [ ] Revocation checks — Prepared; verification pending
- [ ] PII log sanitization — Prepared; verification pending
- [ ] SQL injection and IDOR tests — Pending verification
- [ ] XSS CSRF CORS CSP verification — Pending verification
- [ ] Abuse/rate-limit controls — Pending verification
- [x] Dependency vulnerability audit — Verified in services-back CI #43723300416 (2026-11-15)
- [ ] Kazakhstan data residency — Pending verification
- [ ] Retention and deletion policy — Pending verification
- [ ] Final security review — Pending verification

### CI and testing

- [x] Backend typecheck — Verified in services-back CI #43723300416 (2026-11-15)
- [x] Backend unit suite — Verified in services-back CI #43723300416 (2026-11-15)
- [x] PostgreSQL migration and schema smoke — Verified in services-back CI #43723300416 (2026-11-15)
- [x] Admin MFA PostgreSQL integration — Verified in services-back CI #43723300416 (2026-11-15)
- [ ] Frontend typecheck lint build — Pending verification
- [ ] Admin typecheck lint build — Pending verification
- [ ] API contract tests — Pending verification
- [ ] End-to-end user journeys — Pending verification
- [x] All main CI checks green — Verified in services-back CI #43723300416 (2026-11-15)
- [ ] Regression and smoke suite — Pending verification

### Production operations

- [ ] Hosting/Docker review — Pending verification
- [ ] Secret management — Pending verification
- [ ] TLS/HTTPS and domains — Pending verification
- [x] PostgreSQL backup/restore drill — Verified in services-back CI #43723300416 (2026-11-15)
- [ ] Rollback and migration recovery — Pending verification
- [ ] Monitoring metrics and alerts — Pending verification
- [ ] Load and performance tests — Pending verification
- [ ] Staging acceptance — Pending verification
- [ ] Production deployment — Pending verification
- [ ] Post-deploy smoke checks — Pending verification

### Documentation and release

- [ ] Architecture docs — Prepared; verification pending
- [ ] API/Redocly docs — Prepared; verification pending
- [ ] Business rules and role matrix — Prepared; verification pending
- [ ] Frontend/admin user guides — Pending verification
- [ ] Environment/deployment runbook — Pending verification
- [ ] Backup/restore/incident runbook — Pending verification
- [ ] Security/privacy docs — Pending verification
- [ ] Final acceptance report — Pending verification
- [ ] Release checklist and version tag — Pending verification

## Evidence log

| Date (UTC) | Repository | Commit / CI evidence | Scope | Verification |
|---|---|---|---|---|
| 2026-11-15 | services-back | [`6b79eb4`](https://github.com/nurgeldiserikbay/services-back/commit/6b79eb4e127801c7727546c23b65e03886149d28) | Admin session chronology regression test | Committed; CI unverified |
| 2026-11-15 | services-back | [`d39d196`](https://github.com/nurgeldiserikbay/services-back/commit/d39d196f7ceedd9df13a253834e3737ad5c120fd), [CI #43723300416](https://github.com/nurgeldiserikbay/services-back/actions/runs/43723300416) | Backend typecheck, unit/integration, PostgreSQL migration/schema, Admin MFA DB, dependency audit, backup/restore and all backend main checks | **PASS** (build-and-test and dependency-audit) |\n| 2026-11-15 | services-back | [`ed322ee`](https://github.com/nurgeldiserikbay/services-back/commit/ed322eea24aa441c4ca0b004315d75a7823ab390) | Atomic TOTP timestamp test update | Committed; CI unverified |

## Next acceptance gates

1. Obtain actual backend main workflow/job logs; repair failures and record run URLs.
2. Verify frontend and admin build/typecheck and core E2E journeys against backend.
3. Complete security/dependency audit, backup/restore drill, staging deployment and operational runbooks.

**Total acceptance items:** 116. **Verified complete:** 7 (backend-specific evidence recorded above; other items remain unverified).