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
- [x] Guest capability token security — Verified guest status ownership, expired/consumed/mismatched capability rejection and private-field allowlist in backend CI #43726538338 (2026-11-15)
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
- [x] HTTP payload/response limits — Verified: [Frontend CI #43724021062](https://github.com/nurgeldiserikbay/services-front/actions/runs/43724021062) passed unit/boundary tests, including 8 KiB streamed response limit and strict media-type checks
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
- [x] Frontend typecheck and production build — Verified: [Frontend CI #43724021062](https://github.com/nurgeldiserikbay/services-front/actions/runs/43724021062), `pnpm typecheck` and `pnpm build` both passed on `680a91f`.
- [ ] Frontend lint — Pending verification; frontend workspace has no lint script yet
- [ ] Admin typecheck lint build — Pending verification
- [x] API contract tests — Backend search, public profile, seller and guest HTTP contract regression gate passed in CI #43724266432 (2026-11-15); cross-repository parity remains separately pending
- [ ] End-to-end user journeys — Pending verification
- [ ] All main CI checks green — Backend main passed #43723300416; frontend/admin/docs main checks not yet verified
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

Frontend keyboard navigation (2026-11-15): [frontend `46329a6`](https://github.com/nurgeldiserikbay/services-front/commit/46329a6449006808577b6a9418dce6f2aaaad8c5) introduces localized skip-to-content links, focus-visible CSS, reduced-motion rules and skip targets on every localized page, with a source regression test. [Frontend CI #43726516833](https://github.com/nurgeldiserikbay/services-front/actions/runs/43726516833) pending at recording. **Accessibility and keyboard navigation remains unchecked** pending CI plus real keyboard/screen-reader acceptance.

Frontend PWA install metadata work (2026-11-15): [frontend commit `64c02d5`](https://github.com/nurgeldiserikbay/services-front/commit/64c02d54a9e68888b6422babc2504d581e3b8d83) adds a scoped `/manifest.webmanifest` route, self-contained `/icon.svg`, source regression tests and a live HTTP check in the public search-to-profile journey. [Frontend CI #43724506715](https://github.com/nurgeldiserikbay/services-front/actions/runs/43724506715) pending at recording. **PWA manifest and offline behavior remains unchecked**: service-worker offline caching, installability on devices and accessibility/device acceptance are not yet established.

**2026-11-15 frontend green:** [Frontend CI #43724021062](https://github.com/nurgeldiserikbay/services-front/actions/runs/43724021062) completed **successfully** for frontend commit [`680a91f`](https://github.com/nurgeldiserikbay/services-front/commit/680a91fd2628454fd8faf0299f0142954749ef1f), pinned to backend [`d39d196`](https://github.com/nurgeldiserikbay/services-back/commit/d39d196f7ceedd9df13a253834e3737ad5c120fd). Passed security boundary pretests, dependency audit, unit suite, backend PostgreSQL migrations/database tests, HTTP negative auth boundaries, frontend TypeScript check, Next.js production build and live public search-to-profile E2E. **Not staging or full authenticated guest/seller E2E sign-off**. Frontend lint is not yet configured.

Frontend integration pin refresh (2026-11-15): frontend [commit `680a91f`](https://github.com/nurgeldiserikbay/services-front/commit/680a91fd2628454fd8faf0299f0142954749ef1f) selects backend `d39d196f7ceedd9df13a253834e3737ad5c120fd`, independently verified by [backend CI #43723300416](https://github.com/nurgeldiserikbay/services-back/actions/runs/43723300416) (dependency-audit + build-and-test successful). The previous frontend [run #43723802467](https://github.com/nurgeldiserikbay/services-front/actions/runs/43723802467) passed frontend unit tests, failed on an older pinned backend PostgreSQL regression. New frontend [run #43724021062](https://github.com/nurgeldiserikbay/services-front/actions/runs/43724021062) pending; **do not check off complete frontend CI until full green**.

Frontend workstream (2026-11-15): [frontend `4136456`](https://github.com/nurgeldiserikbay/services-front/commit/41364564118bc44dafd083ce8d1174515c0f2ea5) updates CI gate test order, seller fail-closed regression expectations, staging release status parser, and pinned backend baseline documentation. CI [run #43723802467](https://github.com/nurgeldiserikbay/services-front/actions/runs/43723802467) was triggered; **full verification remains pending**. Frontend checklist items remain unchecked until the corresponding test/build/integration gates pass.

Frontend CI investigation (2026-11-15): [failed run 43710794087](https://github.com/nurgeldiserikbay/services-front/actions/runs/43710794087) stopped at a test fixture that accepted `2026-11-05T11:00:00.123Z` for a `2026-11-04T11:00:00Z` request, exceeding the enforced 24-hour TTL by 123 ms. [Frontend commit `1fdd457`](https://github.com/nurgeldiserikbay/services-front/commit/1fdd457a08333f41e1a9af11df98832a346d79f3) corrected the test fixture to stay within TTL; [new CI run 43723522028](https://github.com/nurgeldiserikbay/services-front/actions/runs/43723522028) was in progress when recorded. Frontend CI/typecheck/build are **not verified green**.

| Date (UTC) | Repository | Commit / CI evidence | Scope | Verification |
|---|---|---|---|---|
| 2026-11-15 | services-back | [`6b79eb4`](https://github.com/nurgeldiserikbay/services-back/commit/6b79eb4e127801c7727546c23b65e03886149d28) | Admin session chronology regression test | Committed; CI unverified |
| 2026-11-15 | services-back | [`d39d196`](https://github.com/nurgeldiserikbay/services-back/commit/d39d196f7ceedd9df13a253834e3737ad5c120fd), [CI #43723300416](https://github.com/nurgeldiserikbay/services-back/actions/runs/43723300416) | Backend typecheck, unit/integration, PostgreSQL migration/schema, Admin MFA DB, dependency audit, backup/restore and backend main checks | **PASS** (build-and-test and dependency-audit) |
| 2026-11-15 | services-back | [`ed322ee`](https://github.com/nurgeldiserikbay/services-back/commit/ed322eea24aa441c4ca0b004315d75a7823ab390) | Atomic TOTP timestamp test update | Committed; CI unverified |
| 2026-11-15 | services-admin | [`ce1f961`](https://github.com/nurgeldiserikbay/services-admin/commit/ce1f961d772e2224c3e8fc2a39f3a7cd04407100) | Admin acceptance gates mapped to master checklist; restricted placeholder confirmed | Documentation committed; UI acceptance pending; CI unverified |

| 2026-11-15 | services-back | [`4d2d5cf`](https://github.com/nurgeldiserikbay/services-back/commit/4d2d5cfeb871d7ceb3db56da57daef2cbba68731) | Early CI gate for search, public profile, seller decision and guest status HTTP contracts | **PASS** in backend CI #43724266432 |
| 2026-11-15 | services-admin | [`e34f45a`](https://github.com/nurgeldiserikbay/services-admin/commit/e34f45a1e30ffcb48240f7729759f846d501b443) | Admin security headers and fail-closed UI regression assertions | Committed; test run and CI unverified |

| 2026-11-15 | services-back | [CI #43724266432](https://github.com/nurgeldiserikbay/services-back/actions/runs/43724266432) | Backend API contract regression step (search, public profile, seller, guest HTTP) | **PASS**; API contract tests verified, cross-repo API parity pending |\n\n| 2026-11-15 | services-admin | [`d0bb295`](https://github.com/nurgeldiserikbay/services-admin/commit/d0bb2954ab03a164549e58300b597d2f9519af47) | Corrected Admin UI inventory: feature-flagged server-authenticated `/moderation` route exists; landing page is placeholder | Code inspected; full UI acceptance and CI unverified |

| 2026-11-15 | services-back | [`0e8526a`](https://github.com/nurgeldiserikbay/services-back/commit/0e8526a488bc257c680a9b031b27eba9f0570ced) | Guest verified request and cancellation policy CI gate | **Pending** CI; full request lifecycle E2E unchecked |\n\n| 2026-11-15 | services-admin | [`a8ae5dd`](https://github.com/nurgeldiserikbay/services-admin/commit/a8ae5dd04aae33bb4d8a9e2677fda5c86c7aeb23), [`39a4f09`](https://github.com/nurgeldiserikbay/services-admin/commit/39a4f0989161b5be1196eb3137d624c14b7f5f7c) | Moderation page heading accessibility fix and server-only gate regression assertions | Committed; CI and browser acceptance unverified |

| 2026-11-15 | services-back | [CI #43724542793](https://github.com/nurgeldiserikbay/services-back/actions/runs/43724542793) | Guest request boundary regressions (verified OTP flow and cancellation policy) | **PASS**; full E2E remains pending |\n| 2026-11-15 | services-back | [`8f7b2a9`](https://github.com/nurgeldiserikbay/services-back/commit/8f7b2a9bc1e96d4c5576ef8a285b7bb4c4b29354) | Early PostgreSQL integration gate for guest OTP proof and atomic request transaction | **Pending** CI |\n\n| 2026-11-15 | services-back | [`4e18645`](https://github.com/nurgeldiserikbay/services-back/commit/4e186459b40c91e2d08c6160904146d5aaad5cc2) | PostgreSQL guest status read: capability expiry, consumption and contact ownership regression | **Pending** CI; guest capability security and full E2E unchecked |\n\n| 2026-11-15 | services-admin | [`3fb160c`](https://github.com/nurgeldiserikbay/services-admin/commit/3fb160ccec163ba3cf33ed111076e7846add5d56) | Enabled admin BFF CI smoke checks denied moderation/logout responses for no-store, noindex and sanitized body | Committed; workflow execution unverified |

| 2026-11-15 | services-back | [CI #43726538338](https://github.com/nurgeldiserikbay/services-back/actions/runs/43726538338) | Guest PostgreSQL transaction and status ownership, expired/consumed capability and response allowlist; guest request boundary regressions | **PASS** (build-and-test + dependency-audit); guest capability token security verified, full request E2E pending |\n\n| 2026-11-15 | services-admin | [`63e8cd4`](https://github.com/nurgeldiserikbay/services-admin/commit/63e8cd4d26d5c579e6ceb3f3cd97bc33272c2035) | Denied moderation/logout CI smoke asserts HTTP 404, JSON, and no Set-Cookie | Committed; CI execution unverified |

## Next acceptance gates

1. Obtain actual backend main workflow/job logs; repair failures and record run URLs.
2. Verify frontend and admin build/typecheck and core E2E journeys against backend.
3. Complete security/dependency audit, backup/restore drill, staging deployment and operational runbooks.

**Total acceptance items:** 117. **Verified complete:** 10 (8 backend checks + 2 frontend CI-verified checks). This strict checkbox count is not the project's historical functional-readiness estimate.