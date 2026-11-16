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
- [x] Session and token handling — Verified PostgreSQL OTP session issuance, owner-scoped inventory/revocation, expired/suspended/revoked session rejection, activity throttling and HTTP bearer boundaries in backend CI #43732961782 (2026-11-15)
- [x] OTP abuse protection — Verified OTP attempt limits, expiry, replay prevention, provider rejection and issuance throttling in backend CI #43728277877 (2026-11-15)
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
- [x] Seller accept/reject actions — Verified transactional accept/decline, scoped seller authorization, idempotent replay and notification integration in backend CI #43737972089 (2026-11-15)
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

- [x] Outbox model — Verified by notification pipeline PostgreSQL CI #43745179540 (2026-11-15); outbox event staging and delivery linkage
- [x] Notification intents — Verified by notification pipeline PostgreSQL CI #43745179540 (2026-11-15); IN_APP and EMAIL intent staging
- [ ] Email/SMS integration — Pending verification
- [ ] Retry and dead-letter handling — Prepared: external delivery failure transaction, bounded retry schedule, terminal FAILED state, and counter-divergence fail-closed protection; prior CI #43805141569 passed, latest counter regression CI pending; claim/lease, provider sender and operational dead-letter replay remain open
- [x] Deduplication — Verified by notification pipeline PostgreSQL CI #43745179540 (2026-11-15); repeated batch produces no duplicate delivery/inbox entries
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
- [x] Admin PostgreSQL and E2E tests — Verified privileged moderation HTTP, live PostgreSQL scope and revocation, admin MFA sessions and authorization in backend CI #43804251293 (2026-11-16); full admin UI acceptance remains separate

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

Frontend city autocomplete stale-result UX (2026-11-16): [frontend `f4e385d`](https://github.com/nurgeldiserikbay/services-front/commit/f4e385d2ca1e8249c2e0aa17f3bbf698a126689a) hides stale city options and errors during debounce pending input; source regression tests added. [CI #43806473016](https://github.com/nurgeldiserikbay/services-front/actions/runs/43806473016) pending; [previous #43805836179](https://github.com/nurgeldiserikbay/services-front/actions/runs/43805836179) passed. Device acceptance remains open.

Frontend city debounce pending-state UX (2026-11-16): [frontend `835e9f8`](https://github.com/nurgeldiserikbay/services-front/commit/835e9f8ed95d78a96f47500d52a76a36c98ab08b) adds pending-input state so the UI does not show stale empty city results during debounce; source regression coverage included. [CI #43805836179](https://github.com/nurgeldiserikbay/services-front/actions/runs/43805836179) pending; [previous #43805449975](https://github.com/nurgeldiserikbay/services-front/actions/runs/43805449975) passed. Manual device acceptance remains open.

Frontend city autocomplete debounce (2026-11-16): [frontend `acee916`](https://github.com/nurgeldiserikbay/services-front/commit/acee916ecd38464ec0a09fa3f1e69fb51ccb45ca) introduces 250ms city-query debounce to reduce requests during typing, preserving AbortController cleanup and adding regression assertions. [CI #43805449975](https://github.com/nurgeldiserikbay/services-front/actions/runs/43805449975) queued; [previous #43804993015](https://github.com/nurgeldiserikbay/services-front/actions/runs/43804993015) passed. Device acceptance remains open.

Frontend city-result CI fix (2026-11-16): [frontend `31d8aae`](https://github.com/nurgeldiserikbay/services-front/commit/31d8aae0200cd0fcbeacb6e06867ec6f682063c6) fixes three stale geography test assertions. [CI #43804651473](https://github.com/nurgeldiserikbay/services-front/actions/runs/43804651473) failed; [#43804993015](https://github.com/nurgeldiserikbay/services-front/actions/runs/43804993015) queued.

Frontend city zero-result UX (2026-11-16): [frontend `0c867fa`](https://github.com/nurgeldiserikbay/services-front/commit/0c867fa247de08583f2b3330c761a79e43367c94) adds localized empty-city feedback and regression tests. [CI #43804651473](https://github.com/nurgeldiserikbay/services-front/actions/runs/43804651473) pending; prior #43804207967 passed.

Frontend country retry UX (2026-11-16): [frontend `cefcb9b`](https://github.com/nurgeldiserikbay/services-front/commit/cefcb9b4c342d67f5604a1c49c6fd59627c5b410) adds localized country directory retry and tests; [CI #43804207967](https://github.com/nurgeldiserikbay/services-front/actions/runs/43804207967) pending; previous #43803673543 passed.

Frontend city lookup retry UX (2026-11-16): [frontend `f2f57ce`](https://github.com/nurgeldiserikbay/services-front/commit/f2f57cef66c9c73c312bde0c6bb5dd8155efa11e) adds localized retry for failed city fetch without resetting filters, with regression tests. [CI #43803673543](https://github.com/nurgeldiserikbay/services-front/actions/runs/43803673543) pending; [previous #43803259315](https://github.com/nurgeldiserikbay/services-front/actions/runs/43803259315) passed.

Frontend CI regression correction (2026-11-16): [frontend `624baae`](https://github.com/nurgeldiserikbay/services-front/commit/624baae435eb0acf052be6e7ae2b4f5affea8098) updates outdated geography retry assertion to expect `setCityError(false)` after country/city error-state separation. [CI #43802871313](https://github.com/nurgeldiserikbay/services-front/actions/runs/43802871313) failed at frontend unit tests due to this stale assertion; [rerun #43803259315](https://github.com/nurgeldiserikbay/services-front/actions/runs/43803259315) queued. No green CI claim until rerun passes.

Frontend independent geography error states (2026-11-16): [frontend `b97bbfc`](https://github.com/nurgeldiserikbay/services-front/commit/b97bbfc2a9eba389607bc6c4b5249b0aaee62a02) separates country-directory and city-query errors so a city retry does not hide country lookup failures, and adds source regression tests. [CI #43802871313](https://github.com/nurgeldiserikbay/services-front/actions/runs/43802871313) pending; [previous CI #43802323716](https://github.com/nurgeldiserikbay/services-front/actions/runs/43802323716) passed. Manual device and assistive technology acceptance remain open.

Frontend geography retry and selected-country retention (2026-11-16): [frontend `c56b352`](https://github.com/nurgeldiserikbay/services-front/commit/c56b352a087f4d6d246d819c1b7746db6cdbf37a) resets stale geography errors on retry and preserves the selected country option while country data loads/fails, with regression tests. [CI #43802323716](https://github.com/nurgeldiserikbay/services-front/actions/runs/43802323716) pending; [previous CI #43801235937](https://github.com/nurgeldiserikbay/services-front/actions/runs/43801235937) passed. Manual device and assistive technology acceptance remain open.

Frontend geography city-picker loading and selection fix (2026-11-16): [frontend `d9ae5ff`](https://github.com/nurgeldiserikbay/services-front/commit/d9ae5ff24e09234ac61969060364770b43b97730) clears stale city options when country/query changes, adds city loading state, preserves selected city as a form option during refresh, and adds regression assertions. [CI #43801235937](https://github.com/nurgeldiserikbay/services-front/actions/runs/43801235937) pending; [previous CI #43747936589](https://github.com/nurgeldiserikbay/services-front/actions/runs/43747936589) passed. Real device and screen-reader acceptance remain open.

Frontend search input accessible description (2026-11-15): [frontend `2773d04`](https://github.com/nurgeldiserikbay/services-front/commit/2773d041bd2273ca07801a30c9b22d66bae3d567) associates the search field with localized results heading via `aria-describedby=results-title`, alongside existing `aria-controls` and a source regression assertion. [CI #43747936589](https://github.com/nurgeldiserikbay/services-front/actions/runs/43747936589) queued. Real-device screen-reader acceptance remains open.

Frontend search input/results accessibility relationship (2026-11-15): [frontend `da6f0bd`](https://github.com/nurgeldiserikbay/services-front/commit/da6f0bd1748dde7aca828bd955373ab15a625223) links the search input via `aria-controls=results-list` to the existing results section and adds a source regression test. [CI #43747795859](https://github.com/nurgeldiserikbay/services-front/actions/runs/43747795859) pending. Real-device and assistive technology acceptance remain open.

Frontend search landmark accessibility (2026-11-15): [frontend `23bc320`](https://github.com/nurgeldiserikbay/services-front/commit/23bc3205549b10c6ef5aca2aa223e5ae1a1cfe10) exposes the marketplace search/filter form as `role=search` and adds source and rendered production HTTP assertions. [CI #43747632577](https://github.com/nurgeldiserikbay/services-front/actions/runs/43747632577) pending; [previous CI #43745157492](https://github.com/nurgeldiserikbay/services-front/actions/runs/43745157492) passed. Manual screen-reader and device acceptance still open.

Frontend accessible search field and empty-state announcement (2026-11-15): [frontend `0f1d8a6`](https://github.com/nurgeldiserikbay/services-front/commit/0f1d8a6965958f068f5721828bff2d969fcbb6fc) sets native `type=search`, mobile search keyboard hint and `role=status` on empty search results, with source regression test. [CI #43745157492](https://github.com/nurgeldiserikbay/services-front/actions/runs/43745157492) pending; [previous CI #43744836807](https://github.com/nurgeldiserikbay/services-front/actions/runs/43744836807) passed. Real-device and screen-reader acceptance remain open.

Frontend robots infrastructure exclusions (2026-11-15): [frontend `bcbaef1`](https://github.com/nurgeldiserikbay/services-front/commit/bcbaef194474b046808c3c3e6a5f9927f64c668b) excludes `/_next/` and `/manifest.webmanifest` from robots crawling while preserving public catalog allow rules, with source and production HTTP assertions. [CI #43744836807](https://github.com/nurgeldiserikbay/services-front/actions/runs/43744836807) pending; device and accessibility acceptance remain open.

Frontend offline worker redirect/auth boundary regressions (2026-11-15): [frontend `455e8ad`](https://github.com/nurgeldiserikbay/services-front/commit/455e8ada2873cbe300bcc49bc2c880f4a5557718) adds executable tests that public navigation redirects (301/302/303/307/308), authentication challenges (401/407), non-GET methods and non-navigation fetch modes are not replaced with offline fallback. [CI #43744717961](https://github.com/nurgeldiserikbay/services-front/actions/runs/43744717961) pending. Device and screen-reader acceptance remain open.

Frontend private workspace root HTTP coverage (2026-11-15): [frontend `668583b`](https://github.com/nurgeldiserikbay/services-front/commit/668583bfa80bf3bd8d3dc51053097f760ecb4f32) expands live production E2E checks to `/kk/account`, `/ru/account`, `/kk/seller`, `/ru/seller`, asserting no-store and noindex alongside nested private paths. [CI #43744592748](https://github.com/nurgeldiserikbay/services-front/actions/runs/43744592748) queued; [previous CI #43744435535](https://github.com/nurgeldiserikbay/services-front/actions/runs/43744435535) success. Real-device PWA and accessibility acceptance remain open.

Frontend robots private workspace root paths (2026-11-15): [frontend `2ed4b8a`](https://github.com/nurgeldiserikbay/services-front/commit/2ed4b8a65bfe6708b6c8abfd195e555fc6dcca15) adds `/kk/account`, `/ru/account`, `/kk/seller`, `/ru/seller` and `/api` to robots exclusions alongside slash-suffixed paths; source and production HTTP assertions added. [CI #43744435535](https://github.com/nurgeldiserikbay/services-front/actions/runs/43744435535) pending; [previous CI #43741717440](https://github.com/nurgeldiserikbay/services-front/actions/runs/43741717440) passed. PWA device and accessibility acceptance remain open.

Frontend PWA activation cleanup failure regression (2026-11-15): [frontend `6be4f77`](https://github.com/nurgeldiserikbay/services-front/commit/6be4f7774e38cb29ccf0b292a9e69e8a78f4490b) adds executable service-worker test verifying `clients.claim()` does not run when obsolete offline cache deletion rejects. [CI #43741717440](https://github.com/nurgeldiserikbay/services-front/actions/runs/43741717440) pending; [previous CI #43741463786](https://github.com/nurgeldiserikbay/services-front/actions/runs/43741463786) passed. Device and accessibility sign-off remain open.

Frontend offline canonical slash paths (2026-11-15): [frontend `f8609ff`](https://github.com/nurgeldiserikbay/services-front/commit/f8609ffe6f2338d52a05728a7cef5adf34668d02) limits generic offline navigation fallback to canonical paths without trailing or repeated slashes, with worker behavior tests. [CI #43741463786](https://github.com/nurgeldiserikbay/services-front/actions/runs/43741463786) queued; [previous CI #43741167094](https://github.com/nurgeldiserikbay/services-front/actions/runs/43741167094) success. Device and accessibility acceptance remain open.

Frontend canonical offline URL matching (2026-11-15): [frontend `892b592`](https://github.com/nurgeldiserikbay/services-front/commit/892b592c17deeec1754af4b64b79e0dbea25e2e7) rejects percent-encoded path components and backslashes before applying public navigation fallback, with behavior tests for encoded profile identifiers. [CI #43741167094](https://github.com/nurgeldiserikbay/services-front/actions/runs/43741167094) pending; [previous CI #43740960577](https://github.com/nurgeldiserikbay/services-front/actions/runs/43740960577) passed. Device and accessibility acceptance remain open.

Frontend encoded path separator protection (2026-11-15): [frontend `a67bfed`](https://github.com/nurgeldiserikbay/services-front/commit/a67bfedd774cda9d3c074159cf7419e3f3661ec7) prevents service worker public profile fallback for URLs containing percent-encoded slash/backslash and adds bypass regressions. [CI #43740960577](https://github.com/nurgeldiserikbay/services-front/actions/runs/43740960577) pending; [previous CI #43740777485](https://github.com/nurgeldiserikbay/services-front/actions/runs/43740777485) success. PWA device acceptance remains open.

Frontend PWA unavailable Cache Storage (2026-11-15): [frontend `85abcd5`](https://github.com/nurgeldiserikbay/services-front/commit/85abcd591d292ff4b94aff5e2fada71055ba44ce) makes public navigation fallback return a network error when browser Cache Storage is unavailable, and adds worker behavior regressions for offline and 503 responses. [CI #43740777485](https://github.com/nurgeldiserikbay/services-front/actions/runs/43740777485) pending; [previous CI #43740545409](https://github.com/nurgeldiserikbay/services-front/actions/runs/43740545409) passed. Real-device PWA acceptance remains open.

Frontend offline route-isolation regressions (2026-11-15): [frontend `2f8a17f`](https://github.com/nurgeldiserikbay/services-front/commit/2f8a17f98059525adbc367a4b1b0fccb12579e2e) adds service worker behavior tests proving account/seller/API/nested private paths bypass interception, and public catalog query-string navigations receive only the generic fallback without response caching. [CI #43740545409](https://github.com/nurgeldiserikbay/services-front/actions/runs/43740545409) queued; [prior CI #43739495740](https://github.com/nurgeldiserikbay/services-front/actions/runs/43739495740) success. Device PWA and screen-reader acceptance still open.

Frontend offline fallback cache-miss regression (2026-11-15): [frontend `fa679e1`](https://github.com/nurgeldiserikbay/services-front/commit/fa679e13330d862075a8c2dc9c955cf33683eb0e) tests that when network and cached generic offline shell are both unavailable, the service worker returns a network error rather than cached private data. [CI #43739495740](https://github.com/nurgeldiserikbay/services-front/actions/runs/43739495740) pending; real-device PWA acceptance still open.

Frontend offline HTTP security (2026-11-15): [frontend `98c6e9a`](https://github.com/nurgeldiserikbay/services-front/commit/98c6e9a6c140b5ddf501a65b023a53b8260ed8b2) adds route-scoped `X-Robots-Tag: noindex, nofollow, noarchive` and `X-Content-Type-Options: nosniff` to `/offline.html` while retaining no-store, plus source and production HTTP regression tests. [CI #43739386983](https://github.com/nurgeldiserikbay/services-front/actions/runs/43739386983) pending; [prior CI #43738267827](https://github.com/nurgeldiserikbay/services-front/actions/runs/43738267827) success. Device and assistive technology acceptance still open.

Frontend PWA viewport metadata (2026-11-15): [frontend `76c811c`](https://github.com/nurgeldiserikbay/services-front/commit/76c811cf7690cc4f10a389d3a291264b258e528b) aligns root viewport theme color with manifest and adds source/production HTTP regression assertions. [CI #43738267827](https://github.com/nurgeldiserikbay/services-front/actions/runs/43738267827) pending. [Previous CI #43737940187](https://github.com/nurgeldiserikbay/services-front/actions/runs/43737940187) passed. Android installation and screen-reader sign-off remain open.

Frontend PWA gateway and device acceptance (2026-11-15): [frontend `c6d3dfe`](https://github.com/nurgeldiserikbay/services-front/commit/c6d3dfe1817bf5b9e3b581ec6628494f2daa9997) expands public offline fallback to 502/503/504 and tests 401/403/404/429/500 unchanged. [Device acceptance checklist](https://github.com/nurgeldiserikbay/services-front/blob/main/docs/pwa-device-acceptance.md) added at [frontend `fe18837`](https://github.com/nurgeldiserikbay/services-front/commit/fe188374aa2fe888fa7e829e405876578ce92dfe) for Android, keyboard, screen reader and private-cache release gates. [CI #43737940187](https://github.com/nurgeldiserikbay/services-front/actions/runs/43737940187) pending; [prior CI #43737276353](https://github.com/nurgeldiserikbay/services-front/actions/runs/43737276353) success. Real-device gates remain open.

Frontend offline gateway outage resilience (2026-11-15): [frontend `078ba1f`](https://github.com/nurgeldiserikbay/services-front/commit/078ba1f7c3f1e7fe47e926b77e14bdd2136bde6b) serves the generic offline fallback for public navigation fetch failures and HTTP 503/504 only; 404/500 remain unmodified. Unit tests cover both and preserve private-route bypass. [CI #43737276353](https://github.com/nurgeldiserikbay/services-front/actions/runs/43737276353) pending. Prior bilingual offline fallback [CI #43737025679](https://github.com/nurgeldiserikbay/services-front/actions/runs/43737025679) success. Device acceptance remains open.

Frontend bilingual offline fallback accessibility (2026-11-15): [frontend `844c665`](https://github.com/nurgeldiserikbay/services-front/commit/844c6654ce0fa06fe2266f4502b0d88b6e068382) adds Kazakh and Russian explicit retry routes, correct Russian language annotations, keyboard/high-contrast focus and source + production HTTP tests. [CI #43737025679](https://github.com/nurgeldiserikbay/services-front/actions/runs/43737025679) pending. Previous offline worker lifecycle [CI #43734806980](https://github.com/nurgeldiserikbay/services-front/actions/runs/43734806980) passed. Real-device PWA offline/install and accessibility review remain open.

Frontend offline worker lifecycle hardening (2026-11-15): [frontend `067585e`](https://github.com/nurgeldiserikbay/services-front/commit/067585ec641c6bdedf336d76045af564ef13b16f) makes `skipWaiting` conditional on successful generic offline fallback precache, claims clients only after obsolete shell caches are deleted, and adds failure/ordering regression tests. [CI #43734806980](https://github.com/nurgeldiserikbay/services-front/actions/runs/43734806980) pending. Prior [CI #43733907607](https://github.com/nurgeldiserikbay/services-front/actions/runs/43733907607) success, including scoped private HTTP headers and high-contrast tests. Real-device PWA and assistive-technology acceptance still open.

Frontend accessibility forced-colors support (2026-11-15): [frontend `535fde7`](https://github.com/nurgeldiserikbay/services-front/commit/535fde72c70728e3b29cf0c1b7467d8e46995d31) adds visible native select/textarea keyboard focus and Windows high-contrast focus/border/link styling with regression tests. [Frontend CI #43733907607](https://github.com/nurgeldiserikbay/services-front/actions/runs/43733907607) pending. Accessibility acceptance still requires actual keyboard and assistive technology review; do not check off yet.

Frontend private-header test regression (2026-11-15): [CI #43733407334](https://github.com/nurgeldiserikbay/services-front/actions/runs/43733407334) failed at `security-headers.test.mjs`: source-level global-header scan accidentally included later private route-scoped `no-store` rules. [Frontend `8bc5fd6`](https://github.com/nurgeldiserikbay/services-front/commit/8bc5fd633577c8857dc84061d9b37decabe82710) narrows scan to the global rule and asserts the block was actually found. [Replacement CI #43733766747](https://github.com/nurgeldiserikbay/services-front/actions/runs/43733766747) pending. Keep private HTTP header acceptance open until the production journey is green.

Frontend private-workspace HTTP protections (2026-11-15): [frontend `3e3f88b`](https://github.com/nurgeldiserikbay/services-front/commit/3e3f88b3c8bf619577178d9a7469646a14da21fd) adds route-scoped `Cache-Control: private, no-store` and `X-Robots-Tag: noindex` for kk/ru account and seller pages, with unit and live production HTTP assertions. This is defense-in-depth, not a substitute for session authorization. [Frontend CI #43733407334](https://github.com/nurgeldiserikbay/services-front/actions/runs/43733407334) pending. Prior robots policy CI #43733255532 was superseded/cancelled by newer commits; its checks must pass in the latest run before signoff.

Frontend public SEO robots policy (2026-11-15): [frontend `b68cd3d`](https://github.com/nurgeldiserikbay/services-front/commit/b68cd3d523182d76910c2c06c1b88b10f10902fc) adds Next.js `/robots.txt` metadata route with published catalog/profile allow rules and account/seller/API/offline exclusions, plus unit and production HTTP assertions. Robots directives are crawler guidance **not an authorization boundary**. [Frontend CI #43733255532](https://github.com/nurgeldiserikbay/services-front/actions/runs/43733255532) pending. Prior [PWA CSP CI #43732910395](https://github.com/nurgeldiserikbay/services-front/actions/runs/43732910395) passed. No device acceptance gate closed.

Frontend PWA CSP hardening (2026-11-15): [frontend `6878129`](https://github.com/nurgeldiserikbay/services-front/commit/6878129979431a61219804191b3918af21a60817) explicitly restricts `worker-src` and `manifest-src` to same-origin in production CSP, with source and production HTTP E2E assertions and public SEO header check. [Frontend CI #43732910395](https://github.com/nurgeldiserikbay/services-front/actions/runs/43732910395) pending at recording. Prior [PWA HTTP cache regression CI #43731722436](https://github.com/nurgeldiserikbay/services-front/actions/runs/43731722436) **success**. Real-device install/offline and accessibility acceptance remain open.

Frontend PWA CI regression fix (2026-11-15): [frontend `7110644`](https://github.com/nurgeldiserikbay/services-front/commit/711064474f7a178c645f078e636426af669d782f) updates the public SEO security-header test to distinguish global page headers from narrowly scoped PWA asset `no-store` rules, and configures service-worker `updateViaCache:'none'` with regression assertion. Previous [CI #43731073267](https://github.com/nurgeldiserikbay/services-front/actions/runs/43731073267) **failed** on the obsolete source-level `Cache-Control.*no-store` assertion; [replacement CI #43731722436](https://github.com/nurgeldiserikbay/services-front/actions/runs/43731722436) pending. Do not mark the new gate complete until green.

Frontend offline worker HTTP hardening (2026-11-15): [frontend `3b01f74`](https://github.com/nurgeldiserikbay/services-front/commit/3b01f747681c18e82dbb6b3d53805b532f7ec8d9) adds `no-store` HTTP headers for `/sw.js` and `/offline.html`, explicit service-worker scope, production HTTP E2E assertions and activation regression tests proving only obsolete Services cache names are deleted. [Frontend CI #43731073267](https://github.com/nurgeldiserikbay/services-front/actions/runs/43731073267) pending. Prior [offline behavioral CI #43728875613](https://github.com/nurgeldiserikbay/services-front/actions/runs/43728875613) passed. Real-device offline and accessibility acceptance remain open.

Frontend offline runtime security tests (2026-11-15): [frontend `e4ed77b`](https://github.com/nurgeldiserikbay/services-front/commit/e4ed77b941692dadca89238c4d806b966bb95f1b) adds executable service-worker tests for public-only offline fallback, private/account/API bypass, network-first online behavior and cache scope. [Frontend CI #43728875613](https://github.com/nurgeldiserikbay/services-front/actions/runs/43728875613) pending at recording. Prior [mobile responsive CI #43728254992](https://github.com/nurgeldiserikbay/services-front/actions/runs/43728254992) **success**. Real mobile/offline browser acceptance remains open.

Frontend responsive hardening (2026-11-15): [frontend `6a40be5`](https://github.com/nurgeldiserikbay/services-front/commit/6a40be5fc2552fd1a54d4fde064843cadfd05405) adds small-screen overflow/wrapping/touch-target CSS and regression tests. [Frontend CI #43728254992](https://github.com/nurgeldiserikbay/services-front/actions/runs/43728254992) pending at recording; **responsive/mobile device acceptance remains unchecked**. Previous offline + keyboard integration [Frontend CI #43728086029](https://github.com/nurgeldiserikbay/services-front/actions/runs/43728086029) completed successfully; real offline device and screen-reader acceptance still pending.

Frontend offline fallback (2026-11-15): [frontend commit `c77d4e4`](https://github.com/nurgeldiserikbay/services-front/commit/c77d4e4ffef04f29c5102babb89993508fa763f7) adds a generic noindex offline HTML shell, a network-first service worker restricted to public `kk`/`ru` navigation, secure-context registration, regression tests for private-data non-caching, and live production HTTP asset checks. [Frontend CI #43728086029](https://github.com/nurgeldiserikbay/services-front/actions/runs/43728086029) running at record time. **Offline device acceptance and complete PWA checklist gate remain pending**; no private/account/API response is intentionally cached.

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

| 2026-11-15 | services-back | [`9e816d6`](https://github.com/nurgeldiserikbay/services-back/commit/9e816d61391b67096eb58d41c44fa62c75b1c7fd) | Added PostgreSQL OTP provider E2E gate for committed send, verification and single-use proof | **Pending** CI; authentication E2E and full request journey remain unchecked |\n\n| 2026-11-15 | services-back | [`e106705`](https://github.com/nurgeldiserikbay/services-back/commit/e106705440b31747d8401af778b9e4cd86969e9b) | Added fail-fast OTP abuse, contact normalization, challenge expiry and guest capability security regression gate | **Pending** new CI; OTP abuse protection acceptance remains unchecked |\n\n| 2026-11-15 | services-admin | [`787c78b`](https://github.com/nurgeldiserikbay/services-admin/commit/787c78b0572442c5c3c27ad623cb9572634c85d7), [`f7c7128`](https://github.com/nurgeldiserikbay/services-admin/commit/f7c71287f6d00ee47c8773d27f4a35b52f6d42b8) | Accessible moderation loading state and sanitized retryable error boundary | Committed; build/CI and browser acceptance unverified |

| 2026-11-15 | services-back | [CI #43728277877](https://github.com/nurgeldiserikbay/services-back/actions/runs/43728277877) | OTP abuse and capability fail-fast regression, guest PostgreSQL transaction and OTP provider send/verify/single-use E2E | **PASS** (build-and-test and dependency-audit); OTP abuse protection verified; full authentication and request journey E2E pending |\n\n| 2026-11-15 | services-admin | [`a40a11e`](https://github.com/nurgeldiserikbay/services-admin/commit/a40a11ec7bc63e91e5295ba7bb6440f0d6c4bd03), [`c142b46`](https://github.com/nurgeldiserikbay/services-admin/commit/c142b46237555d2b58bce340b922d86e6a64e24e) | Regression assertions for moderation loading/error accessibility and sensitive diagnostic redaction | Committed; test execution and CI unverified |

| 2026-11-15 | services-back | [`fa367ac`](https://github.com/nurgeldiserikbay/services-back/commit/fa367ac248eeb273f70dacafa5f85780cbe3bf30) | Early HTTP authentication boundary and remote account-session revocation regressions | **Pending** CI; full authentication E2E acceptance remains unchecked |\n\n| 2026-11-15 | services-admin | [`f17f5a8`](https://github.com/nurgeldiserikbay/services-admin/commit/f17f5a874ed4c89fbb2fe8fe90121b96e6201871), [`90c1082`](https://github.com/nurgeldiserikbay/services-admin/commit/90c10822c622260dbfa789535f79770be2aa8d7c) | Client-side kind/state filters for already authorized moderation rows; source-level boundary regression | Committed; build/CI and E2E acceptance unverified |

| 2026-11-15 | services-back | [`d090279`](https://github.com/nurgeldiserikbay/services-back/commit/d090279247035827ad7bc315695be87be02d17a9) | PostgreSQL OTP sign-in, session replay and private HTTP login integration added as early CI gate | **Pending** CI; complete authentication E2E acceptance remains unchecked |\n\n| 2026-11-15 | services-admin | [`ad6c04c`](https://github.com/nurgeldiserikbay/services-admin/commit/ad6c04c6caee6ed01511fb6c66cb5e11a8ec685e), [`2d8e0ce`](https://github.com/nurgeldiserikbay/services-admin/commit/2d8e0ce4ee1c1b03d439e3248eb229d9c6a9c645) | Moderation filter reset and accessible current-page result announcements with regression assertions | Committed; CI and browser acceptance unverified |

| 2026-11-15 | services-back | [CI #43731174397](https://github.com/nurgeldiserikbay/services-back/actions/runs/43731174397), [`58f9efb`](https://github.com/nurgeldiserikbay/services-back/commit/58f9efb53132b1b34e92b7eb8a26a913bdf11250) | Account HTTP bearer and remote revoke DB tests failed before migrations (missing users relation); relocated gate after schema verification | **Fix committed; CI pending**; authentication E2E unchecked |\n\n| 2026-11-15 | services-admin | [`9407f22`](https://github.com/nurgeldiserikbay/services-admin/commit/9407f2287dc15fe590944e9ef2ab858a63012cf8), [`4918454`](https://github.com/nurgeldiserikbay/services-admin/commit/4918454fb66a4b7df7da0be48caf1ef33867fb11) | Responsive moderation filters, keyboard focus-visible styles and h1 heading CSS fix | Committed; CI and visual/browser acceptance unverified |

| 2026-11-15 | services-back | [CI #43731746957](https://github.com/nurgeldiserikbay/services-back/actions/runs/43731746957) | PostgreSQL account OTP sign-in/private HTTP login and bearer session/remote revoke tests | **PASS**; full authentication E2E pending |\n| 2026-11-15 | services-back | [`74aba67`](https://github.com/nurgeldiserikbay/services-back/commit/74aba67093b1601dbd7a147e977b39087b966d62) | Account session ownership, activity throttle and revoked/suspended/expired session PostgreSQL gate | **Pending** CI |\n\n| 2026-11-15 | services-back | [CI #43732961782](https://github.com/nurgeldiserikbay/services-back/actions/runs/43732961782) | PostgreSQL account session ownership/activity/revocation, OTP sign-in, bearer HTTP authorization and dependency audit | **PASS**; session and token handling verified; full authentication E2E remains pending |\n\n| 2026-11-15 | services-back | [`adfdb27`](https://github.com/nurgeldiserikbay/services-back/commit/adfdb27e20ca7967fa51ea402062796952afa596) | Added PostgreSQL account OTP trusted-edge network proof, per-network send ceiling and global minute/hour/day quota gate | **Pending** CI; general rate-limit acceptance unchecked |\n\n| 2026-11-15 | services-admin | [`54ca3d7`](https://github.com/nurgeldiserikbay/services-admin/commit/54ca3d7414dcdced187b94ab47f2b95669bfef84), [`88a9e0d`](https://github.com/nurgeldiserikbay/services-admin/commit/88a9e0d9e6280e57b731d6b05800bcfc34f17275) | Stable local date sorting for authorized moderation page and source regression coverage | Committed; CI/E2E unverified |

| 2026-11-15 | services-back | [CI #43733427583](https://github.com/nurgeldiserikbay/services-back/actions/runs/43733427583) | Account OTP network and global quota PostgreSQL regressions | **PASS**; broader rate-limit acceptance still pending |\n| 2026-11-15 | services-back | [`c509168`](https://github.com/nurgeldiserikbay/services-back/commit/c5091684556b7175ebaf26ac8c1661a5048774b1) | Account OTP verification attempts, replay, expiry and unconfirmed delivery PostgreSQL CI gate | **Pending** CI |\n\n| 2026-11-15 | services-admin | [`334f862`](https://github.com/nurgeldiserikbay/services-admin/commit/334f8621f39915934938dd8e57fd75e1d3d17d2e), [`8807445`](https://github.com/nurgeldiserikbay/services-admin/commit/88074455f0c5496ef26330e454138b99847f1d61), [`bee660b`](https://github.com/nurgeldiserikbay/services-admin/commit/bee660beb460c06be3d0df1cb2f006a132cc0453) | Keyboard-focusable moderation table scroll region, visible focus ring and source regression assertion | Committed; CI and browser acceptance unverified |

| 2026-11-15 | services-admin | [`b3cd381`](https://github.com/nurgeldiserikbay/services-admin/commit/b3cd3816f2e0cdfd76b50077a834bd326c4727d6), [`79f3ae2`](https://github.com/nurgeldiserikbay/services-admin/commit/79f3ae2e77aef2f0386e379ecf088022a83eefd1) | Bounded local case-ID search across already authorized moderation rows, with regression assertions | Committed; CI and E2E acceptance unverified |

| 2026-11-15 | services-admin | [`4dcb710`](https://github.com/nurgeldiserikbay/services-admin/commit/4dcb7106ab44ec5f9f935c5881144367f921a954) | Production smoke assertions for unsupported admin BFF methods, malformed/duplicate cookies and no denied-session cookie mutation | Committed; CI run result pending |

| 2026-11-15 | services-back | [CI #43733951815](https://github.com/nurgeldiserikbay/services-back/actions/runs/43733951815) | Account OTP verification replay, confirmed delivery, network/global quotas and sign-in | **PASS** |\n| 2026-11-15 | services-back | [CI #43734828654](https://github.com/nurgeldiserikbay/services-back/actions/runs/43734828654) | OTP provider deadline, late-response rejection, network retention cleanup, verification and abuse quotas | **PASS**; general rate-limit and full authentication E2E acceptance remain pending |\n\n| 2026-11-15 | services-admin | [`72a25db`](https://github.com/nurgeldiserikbay/services-admin/commit/72a25db1866ae16ad8fbd2d9e4d610986af2ba6b) | Inspected registered admin backend HTTP module: MFA login function exists but trusted primary-factor HTTP login route is not registered; documented security dependency and rollout blockers | Contract gap confirmed by source; Admin UI login/E2E remains pending |

| 2026-11-15 | services-admin | [`fea40d4`](https://github.com/nurgeldiserikbay/services-admin/commit/fea40d4337151d696559166e00048ea0386daf87), [`5f75c00`](https://github.com/nurgeldiserikbay/services-admin/commit/5f75c00f25fe4159f881bb13f081c46de824c104) | Marked privileged admin backend transport server-only and added client import boundary regression | Committed; CI/build acceptance pending |

| 2026-11-15 | services-back | [`da80829`](https://github.com/nurgeldiserikbay/services-back/commit/da808291821b381c88ca533d3145c0634b60a79a) | Added PostgreSQL seller inbox authorization, accept/decline transaction and idempotent audited decision CI gate | **Pending** CI; full request lifecycle E2E remains unchecked |\n\n| 2026-11-15 | services-back | [`14d2010`](https://github.com/nurgeldiserikbay/services-back/commit/14d201012521d23894220de7aec6d52c71754a8f), [`f7ac8ee`](https://github.com/nurgeldiserikbay/services-back/commit/f7ac8ee64268c9804281a781e299327e019f716f) | Moderation response rechecks session and MFA expiry after SQL execution; added regression tests for both mid-query expiry paths | Committed; test/CI execution not independently verified |

| 2026-11-15 | services-back | [CI #43737972089](https://github.com/nurgeldiserikbay/services-back/actions/runs/43737972089) | Seller inbox/accept/decline/idempotency and OTP-authenticated seller journey PostgreSQL integration | **PASS**; seller accept/reject verified, full request lifecycle E2E pending |\n\n| 2026-11-15 | services-back | [`e532cb9`](https://github.com/nurgeldiserikbay/services-back/commit/e532cb9aefb5e4fcf2bc7498c7e8c6190f04b88c) | Added PostgreSQL seller authority parity, outbox/notification rollback and competing-decision serialization gate | **Pending** CI; end-to-end request lifecycle remains unchecked |\n\n| 2026-11-15 | services-back | [`df8ff5f`](https://github.com/nurgeldiserikbay/services-back/commit/df8ff5f8fe09d3d733f4de30a8acff6673ff72d3), [`1ae33b9`](https://github.com/nurgeldiserikbay/services-back/commit/1ae33b95d64d2865662328dd647558bd4d2352d0) | Final moderation SQL grant gate also requires active, activated TOTP factor, with source regression assertion | Committed; CI and PostgreSQL E2E verification pending |

| 2026-11-15 | services-back | [`a910f71`](https://github.com/nurgeldiserikbay/services-back/commit/a910f71be0f1a38102ce63c62ecc1f54f189db2d), [`c71d4d9`](https://github.com/nurgeldiserikbay/services-back/commit/c71d4d904a9269f37c35c282942e3c8056f46899) | PostgreSQL integration test now exercises immediate denial of an existing admin bearer after TOTP disable and after live moderation grant revocation, alongside session revocation | Committed; migrated PostgreSQL CI execution pending |

| 2026-11-15 | services-back | [`2d2271d`](https://github.com/nurgeldiserikbay/services-back/commit/2d2271dbdfa598410dc1c28cfecce92b49b6d393) | Wired admin moderation service and PostgreSQL integration tests into backend CI after migration and schema verification; exercises TOTP disable, grant removal and session revocation | CI configured; successful run still unverified |

| 2026-11-15 | services-back | [`31dc3f2`](https://github.com/nurgeldiserikbay/services-back/commit/31dc3f24f4f1d65094e1bab8cb65b479d0e126b3), [`bb28e0f`](https://github.com/nurgeldiserikbay/services-back/commit/bb28e0f981cc0d0999764605dd162abc816ae53f), [`c0fb964`](https://github.com/nurgeldiserikbay/services-back/commit/c0fb9641e9de37ea3a9e716ce38a8c784f01c2be) | Admin MFA login now resolves recent account proof in the privileged transaction; rejects partial proof objects and discards connections after failed rollback, with regressions | Committed; CI and HTTP acceptance pending |

| 2026-11-15 | services-back | [`31d9736`](https://github.com/nurgeldiserikbay/services-back/commit/31d9736026da887dca21698e9a4c76885359627f), [`95772df`](https://github.com/nurgeldiserikbay/services-back/commit/95772dfdca0b86e1ea9235bb0056621294a9830b) | Reject noncanonical account bearer before opening privileged MFA DB transaction; regression for malformed proof and HMAC key reuse | Committed; CI/typecheck unverified |

| 2026-11-15 | services-back | [`5b2e519`](https://github.com/nurgeldiserikbay/services-back/commit/5b2e5191269c7314c670426c4b73643c26595f99) | Expanded PostgreSQL admin primary-factor acceptance regressions: missing/future issuance, expiry, staff disable, account suspension | Committed; CI execution pending |

| 2026-11-15 | services-back | [`6163f2c`](https://github.com/nurgeldiserikbay/services-back/commit/6163f2c22e4ce84b3c9adc9cc396988000c52a93), [`8a96064`](https://github.com/nurgeldiserikbay/services-back/commit/8a96064567cb3108e3fa3a004a0026bc02db394f) | Removed early TOTP format rejection from trusted account MFA wrapper so authenticated malformed codes reach the durable attempt/lockout path; added regression | Committed; CI execution and end-to-end HTTP acceptance pending |

| 2026-11-15 | services-back | [`0a6c1dd`](https://github.com/nurgeldiserikbay/services-back/commit/0a6c1ddd0e3a1804965f99b0a5dfa450163f4600), [`714912e`](https://github.com/nurgeldiserikbay/services-back/commit/714912e130a3aac04902914d74d7cd3bacd36f01) | Admin MFA regression: malformed TOTP after valid primary must persist lockout/audit; invalid primary must not load factor key or perform privileged SQL | Committed; CI verification pending |

| 2026-11-15 | services-back | [`2578286`](https://github.com/nurgeldiserikbay/services-back/commit/25782869caecd33178138abedff6fbc57d2a7fce), [`b876309`](https://github.com/nurgeldiserikbay/services-back/commit/b8763092d7bb36f5e10659751ba4c7dea4d296dd) | Fixed MFA test fixture query argument type mismatch; extended PostgreSQL primary account proof to reject unknown staff roles | Committed; typecheck/CI pending |

| 2026-11-15 | services-back | [`24b9c52`](https://github.com/nurgeldiserikbay/services-back/commit/24b9c52c63c8967901490087a8c5d0d197aad509), [`7fd1d7c`](https://github.com/nurgeldiserikbay/services-back/commit/7fd1d7c6e6588c68789eb7faa0c552c206ab2728) | Backend admin logout acknowledges revocation only if a session row was actually revoked; repeated/unknown bearer now denied; HTTP regression updated | Committed; CI execution pending |

| 2026-11-16 | services-back | [`46139ab`](https://github.com/nurgeldiserikbay/services-back/commit/46139abf98fdd8c0caa715a39c14dfdccbcb7994), [`bd12d86`](https://github.com/nurgeldiserikbay/services-back/commit/bd12d86a3e11695632b8a7a58f7fb4a4876f4f0d) | Admin MFA COMMIT uncertainty: discard connection and do not issue a misleading ROLLBACK; regression assertion updated | Committed, CI execution unverified |


| 2026-11-16 | services-back | [`c02f5bf`](https://github.com/nurgeldiserikbay/services-back/commit/c02f5bf744b1363d292b97e3e539fd585aed718c), [CI #43803077283](https://github.com/nurgeldiserikbay/services-back/actions/runs/43803077283) | Added fail-fast enabled/disabled privileged moderation HTTP permission and PostgreSQL authorization E2E gate after schema migrations, before broader test suite | **Queued / not yet verified**; admin PostgreSQL and E2E acceptance remains unchecked |

| 2026-11-16 | services-back | [`ee2845e`](https://github.com/nurgeldiserikbay/services-back/commit/ee2845ecf607120167e9aaa0ad0072a5c6b0ad08) | CI main concurrency policy changed to preserve in-flight main runs during parallel pushes; superseded PR runs may still be cancelled | **Committed; verification of new workflow run pending**; all-main-CI-green remains unchecked |

| 2026-11-16 | services-back | [`a6a9035`](https://github.com/nurgeldiserikbay/services-back/commit/a6a90359b6e1c46c824680c01d6d8ced1a35448e) | Transaction tests: SET LOCAL failure rolls back without callback; connection acquisition failure maps to unavailable | Committed; CI not independently verified |

| 2026-11-16 | services-back | [`4b41f5e`](https://github.com/nurgeldiserikbay/services-back/commit/4b41f5e1c327eecd7fc97e40698a57962b1927c7), [CI #43803692621](https://github.com/nurgeldiserikbay/services-back/actions/runs/43803692621) | Fixed undeclared query params in account-primary MFA transaction regression and forwarded parameters to the underlying mock; previous [CI #43803328544](https://github.com/nurgeldiserikbay/services-back/actions/runs/43803328544) failed TypeScript typecheck TS2304 | **Pending CI**; backend typecheck and main green status not re-verified |

| 2026-11-16 | services-back | [`98f2f54`](https://github.com/nurgeldiserikbay/services-back/commit/98f2f54011a2200ed98827007d812400269a94d5), [CI #43804193702](https://github.com/nurgeldiserikbay/services-back/actions/runs/43804193702) | Repaired CI structural regression after main concurrency-policy change: assert main runs are preserved and PR runs can be superseded; previous [CI #43803723792](https://github.com/nurgeldiserikbay/services-back/actions/runs/43803723792) reached full suite but failed `ci-database-order.test.ts` | **Pending CI**; full backend green not yet verified |

| 2026-11-16 | services-back | [`e2c1c60`](https://github.com/nurgeldiserikbay/services-back/commit/e2c1c60be980448da7582a750472773aa230b732), [CI #43804251293](https://github.com/nurgeldiserikbay/services-back/actions/runs/43804251293), [CI #43804193702](https://github.com/nurgeldiserikbay/services-back/actions/runs/43804193702) | Full backend main build-and-test and dependency-audit PASS; includes privileged moderation live HTTP/PostgreSQL E2E, admin session/MFA, schema, unit and smoke gates | **PASS**; admin PostgreSQL/E2E acceptance verified; admin UI, cross-repo CI and production sign-off remain pending |

| 2026-11-16 | services-back | [`8d44e09`](https://github.com/nurgeldiserikbay/services-back/commit/8d44e0901cc4821eaaa994c50e97322a66d4287e), [`c2d41ec`](https://github.com/nurgeldiserikbay/services-back/commit/c2d41ec4cbdebcb58251b83e03be0441eccd029c), [`fdf7807`](https://github.com/nurgeldiserikbay/services-back/commit/fdf7807c88f1c7494159cc124d041018f3607d6b), [`0cf8362`](https://github.com/nurgeldiserikbay/services-back/commit/0cf83621f25db33c4693effb719c6c0fcc77c4b6), [`fb588ac`](https://github.com/nurgeldiserikbay/services-back/commit/fb588ace89694fbc8c0beaafe876fd36a88dcf16) | Added transaction-scoped external EMAIL/SMS failure persistence, bounded retry and terminal FAILED transition, due-time guard, PostgreSQL regression and fail-fast CI step; sender, claim/lease, replay and full dead-letter operation are NOT implemented | **Pending CI**, no retry/dead-letter acceptance checkbox closed |

| 2026-11-16 | services-back | [`89f4be6`](https://github.com/nurgeldiserikbay/services-back/commit/89f4be68efb6074d8ad4958cb048abb73d2ae1ad), [CI #43805141569](https://github.com/nurgeldiserikbay/services-back/actions/runs/43805141569) | Full backend CI passed including PostgreSQL external failure/retry/terminal regression; no external sender, lease or dead-letter replay implemented | **PASS** for retry persistence gate only; overall retry/dead-letter unchecked |
| 2026-11-16 | services-back | [`e10206e`](https://github.com/nurgeldiserikbay/services-back/commit/e10206e4d7964c4195d4ee1a2aac1ba530fd486a), [`0258ca0`](https://github.com/nurgeldiserikbay/services-back/commit/0258ca00f9a770710e6209548f2d7395259bb46f), [CI #43805510366](https://github.com/nurgeldiserikbay/services-back/actions/runs/43805510366) | Fail-closed if notification_delivery and notification_intent persistent retry counters diverge; PostgreSQL test proves no silent repair | **Pending** new CI; release gate unchanged |

| 2026-11-16 | services-back | [`252c9aa`](https://github.com/nurgeldiserikbay/services-back/commit/252c9aaa32fa06556b6f9b5ea36eb50a47f835f5), [`01406e9`](https://github.com/nurgeldiserikbay/services-back/commit/01406e9219e3bc38b3751a9ce6f13f6902d41684), [CI #43806055155](https://github.com/nurgeldiserikbay/services-back/actions/runs/43806055155) | Fixed privileged MFA rollback-original-error regression and simulated real authentication denial on pool release failure; full backend build-and-test and dependency-audit completed | **PASS**; delivery worker claim/lease and provider sending remain pending |

## Next acceptance gates

1. Obtain actual backend main workflow/job logs; repair failures and record run URLs.
2. Verify frontend and admin build/typecheck and core E2E journeys against backend.
3. Complete security/dependency audit, backup/restore drill, staging deployment and operational runbooks.

**Total acceptance items:** 117. **Verified complete:** 17 (15 backend checks + 2 frontend CI-verified checks). This strict checkbox count is not the project's historical functional-readiness estimate.
| 2026-11-15 | services-back | [`8e4eeb7`](https://github.com/nurgeldiserikbay/services-back/commit/8e4eeb7b9ca88f315b98946ed72c766e4a5fb4f4), [CI #43745179540](https://github.com/nurgeldiserikbay/services-back/actions/runs/43745179540) | Notification outbox and intents staging, idempotent IN_APP materialization, authenticated per-person inbox isolation, revocation; admin primary account proof and schedule proposal PostgreSQL gates | **PASS** (build-and-test and dependency-audit); external email/SMS delivery and dead-letter remain pending |
