# API design/runtime gap triage — static baseline, 2026-11-25

**Status: OPEN — classification awaiting product/security approval.** This document pins the
[services documentation source-inspection report](https://github.com/nurgeldiserikbay/services/blob/main/docs/api-runtime-route-inventory-2026-11-18.md)
(2026-11-23 snapshot). It tracks **method/path shapes**, not DTOs, success/error statuses, feature-flag activation, authentication, or live HTTP reachability.
No route is automatically exposed, implemented, or removed by this report.

| Metric | Static baseline |
| --- | ---: |
| Design operations | 65 |
| Runtime controller declarations | 46 |
| Method/path shape matches | 29 |
| Design-only (missing runtime shape) | 36 |
| Runtime-only (not in design) | 17 |

## Design-only operations — 36, all awaiting product prioritization

Each route needs an explicit decision: **mandatory / deferred / intentionally internal**;
these values are **not assigned without approval**. "Missing" does not necessarily imply
business functionality is absent; a different private endpoint may exist.

| Method and route | Domain (triage grouping) | Decision |
| --- | --- | --- |
| `DELETE /me/saved-items/{id}` | Account/self-service | Review needed |
| `GET /geo/suggestion` | Geography | Review needed |
| `GET /me/availability-allocations` | Account/self-service | Review needed |
| `GET /me/reliability` | Account/self-service | Review needed |
| `GET /me/requests` | Account/self-service | Review needed |
| `GET /me/saved-items` | Account/self-service | Review needed |
| `GET /organizations/{id}/professionals/{profile_id}` | Organizations | Review needed |
| `GET /public-availability` | Availability | Review needed |
| `GET /requests/{id}/cancellation-preview` | Requests/scheduling | Review needed |
| `GET /sellers/{kind}/{id}/reliability` | Reliability | Review needed |
| `GET /service-offers/{id}/cancellation-policy` | Offers | Review needed |
| `PATCH /requests/{id}/schedule` | Requests/scheduling | Review needed |
| `PATCH /service-offers/{id}` | Offers | Review needed |
| `POST /admin/no-show-claims/{claimId}/decision` | Admin | Review needed |
| `POST /auth/challenges` | Identity | Review needed |
| `POST /auth/challenges/{id}/verify` | Identity | Review needed |
| `POST /auth/logout-all` | Identity | Review needed |
| `POST /auth/refresh` | Identity | Review needed |
| `POST /experiences/{id}/reviews` | Reviews | Review needed |
| `POST /guest-requests/recovery/challenges` | Guest flows | Review needed |
| `POST /guest-requests/recovery/challenges/{id}/verify` | Guest flows | Review needed |
| `POST /guest-requests/recovery/requests/{id}/session` | Guest flows | Review needed |
| `POST /me/professional-profiles/{id}/lifecycle` | Account/self-service | Review needed |
| `POST /me/saved-items` | Account/self-service | Review needed |
| `POST /organizations` | Organizations | Review needed |
| `POST /organizations/{id}/affiliation-invites` | Organizations | Review needed |
| `POST /reliability-events/{id}/appeal` | Reliability | Review needed |
| `POST /requests` | Requests/scheduling | Review needed |
| `POST /requests/{id}/complete` | Requests/scheduling | Review needed |
| `POST /requests/{id}/no-show-claims` | Requests/scheduling | Review needed |
| `POST /requests/{id}/no-show-claims/{claimId}/response` | Requests/scheduling | Review needed |
| `POST /service-offers` | Offers | Review needed |
| `PUT /me/availability-allocations` | Account/self-service | Review needed |
| `PUT /organizations/{id}/professionals/{profile_id}/view` | Organizations | Review needed |
| `PUT /professional-profiles/{id}/company-views/{organization_id}/permissions` | Professional profiles | Review needed |
| `PUT /service-offers/{id}/cancellation-policy` | Offers | Review needed |

## Runtime-only declarations — 17, all awaiting security/exposure review

For each item, confirm actual AppModule exposure, feature-flag defaults, account or
privileged authentication, HTTP status and response DTO, BFF consumer, and operator
approval before treating it as a supported public API. An entry in router metadata
is **not** evidence that the endpoint is enabled.

| Method and route | Domain (triage grouping) | Review state |
| --- | --- | --- |
| `DELETE /auth/sessions/{id}` | Identity | Review needed |
| `GET /account/requests` | Other | Review needed |
| `GET /admin/moderation/cases` | Admin | Review needed |
| `GET /health` | Other | Review needed |
| `GET /me/professional-profiles/{id}/appealable-rejection` | Account/self-service | Review needed |
| `GET /me/professional-profiles/{id}/preview` | Account/self-service | Review needed |
| `POST /account/requests` | Other | Review needed |
| `POST /account/requests/{id}/complete` | Other | Review needed |
| `POST /admin/moderation/cases/{id}/decision` | Admin | Review needed |
| `POST /admin/session/logout` | Admin | Review needed |
| `POST /auth/private/account/challenges` | Identity | Review needed |
| `POST /auth/private/account/verify` | Identity | Review needed |
| `POST /guest-requests/{id}/completion/challenges` | Guest flows | Review needed |
| `POST /guest-requests/{id}/completion/challenges/{challengeId}/verify` | Guest flows | Review needed |
| `POST /guest-requests/{id}/completion/confirm` | Guest flows | Review needed |
| `POST /me/professional-profiles/{id}/appeals` | Account/self-service | Review needed |
| `POST /me/professional-profiles/{id}/publish` | Account/self-service | Review needed |

## Runtime-only professional moderation decision — live grant-revocation HTTP proof

- `POST /admin/moderation/cases/{id}/decision` is a private administrative mutation requiring a current scoped operator/admin grant, active TOTP-backed MFA session, JSON-only server-to-server request and no browser Origin. It is not automatically exposed to browsers.
- `test/admin-decision-network-http-grant-revocation.test.ts` executes the real controller and decision service over loopback HTTP using a migrated transactional PostgreSQL fixture. It verifies an authorized decision persists, then removes the operator grant and proves a second undecided case cannot transition or acquire approval evidence; even replay of the previously accepted decision receives 401 after revocation. A cross-origin request is denied before mutation.
- This is CI-only PostgreSQL authorization evidence, not approval of a real privileged BFF, network ingress, session issuing/OTP provider or Kazakhstan staging. The route remains runtime-only relative to the design OpenAPI pending explicit product/security review.

## Runtime-only moderation list — HTTP boundary smoke

- `GET /admin/moderation/cases`: `PlatformModerationReadController` is registered in `AppModule`; its service requires the exact `SERVICES_ENABLE_PLATFORM_MODERATION_HTTP=enabled` switch, a valid private admin bearer, a currently authorized moderation scope and fresh MFA evidence before querying cases. The query rechecks session/grants and only returns redacted case metadata.
- `test/admin-moderation-read-network-http.test.ts` checks default-off, malformed bearer denial without DB access and an authorized, scoped, uncached response via a **real loopback Nest HTTP server with a stubbed transaction boundary**. It does **not** validate a real PostgreSQL grant lifecycle or the external privileged BFF/ingress and needs independent operator/security review.

## Runtime-only session management — real HTTP and PostgreSQL authorization

- `DELETE /auth/sessions/{id}` is an authenticated bearer-only remote revocation route; the server derives the account from a live session, validates the target UUID and constrains the SQL mutation to the caller's own account. Unknown and foreign UUID targets must return indistinguishable `204` responses, without revoking the foreign session.
- `POST /auth/logout` is a design-matched route but shares the bearer lifecycle; a successful `204` invalidates the caller's session immediately, and replay must return `401` without affecting unrelated accounts.
- `GET /auth/sessions` is a design-matched companion route. A valid caller sees only own session summaries, never bearer tokens, session HMACs or foreign IDs; anonymous and revoked callers get `401`.
- `test/account-session-network-http-e2e.test.ts` exercises all three with real loopback Nest HTTP requests and a migrated transactional PostgreSQL fixture. It does not establish browser BFF/CSRF acceptance or the entire OpenAPI DTO contract. Remote session revocation remains a runtime-only API discrepancy awaiting product/security approval.

## Runtime-only private account routes — executable deny-by-default regression

- `POST /auth/private/account/verify`: `AccountLoginPrivateController.verify` calls `requirePrivateAccountLoginAccess` before body validation and `signIn`. It remains disabled unless `SERVICES_ENABLE_ACCOUNT_LOGIN_HTTP=enabled`; an invalid or absent `x-services-account-login-key` returns a sanitized 404 before service invocation.
- `POST /auth/private/account/challenges`: `AccountOtpDispatchPrivateController.issue` independently requires `SERVICES_ENABLE_ACCOUNT_OTP_DISPATCH_HTTP=enabled` and the same separate private BFF key check before dispatch; invalid or absent key returns a sanitized 404. Provider wiring and an operator-controlled trusted network boundary still need independent review.
- `test/private-account-runtime-only-route-boundary.test.ts` verifies both release switches deny by default, remain independent, and reject untrusted keys without calling downstream sign-in/dispatch services. This is a controller-level regression, **not** proof that the deployed ingress is private, the OTP provider is approved or the full API contract matches OpenAPI. These routes are **still awaiting security acceptance**.

## Mismatched semantics requiring particular care

- `GET /requests/{id}` is declared by the guest capability status controller.
  A method/path match does not establish logged-in customer request semantics.
- `POST /auth/challenges` and `POST /auth/challenges/{id}/verify` must **not** be
  assumed equivalent to default-off `/auth/private/account/*` routes. A live
  provider adapter, abuse controls and security review are separate acceptance.
- `GET /me/requests` in design must not be treated as equivalent to the
  runtime `GET /account/requests` without an explicit consumer/contract decision.
- Design `POST /requests` and runtime `POST /account/requests` and
  `POST /guest-requests` can have distinct owner/proof requirements; do not alias
  them merely to increase the match count.
- Design and runtime schedule-access parameter names can differ even when
  their method/path **shape** matches. Confirm exact parameter names and DTOs.
- Admin moderation, session revocation, private account verification, and
  guest completion must remain behind their current controls. Never turn on
  an endpoint simply to make these inventories match.

## Update and acceptance procedure

1. Product owner decides mandatory/deferred/internal for every design-only entry.
2. Security owner documents exposure, auth, feature flag, DTO and intended BFF
   for every runtime-only entry; record actual disabled paths separately.
3. For matched routes, verify DTO, HTTP statuses, auth, parameter names and
   account/guest semantics, and run cross-repository HTTP E2E against migrated DB.
4. Update `contracts/api-design-gap-baseline.json` only with reviewed evidence;
   the backend CI drift gate flags undocumented changes. Update the source
   OpenAPI in the docs repo **only after** approved product decisions.
5. Keep top-level **API contract parity [ ]** and strict **29/117** accepted items
   unchanged until comprehensive design/runtime/client approval.

CI success here proves only that the recorded set differences have not changed,
not that missing functionality has been delivered or exposed.

## Release decision queue — evidence versus unresolved approval (2026-11-25)

This queue makes the **next review actions** explicit without assigning unapproved
mandatory/deferred/internal classifications. Passing a regression test is not
equivalent to product approval, production exposure or an accepted OpenAPI contract.

| Priority | Design/runtime boundary | Existing evidence | Required next decision / gate | Status |
| --- | --- | --- | --- | --- |
| P0 | Design `POST /auth/challenges`, `POST /auth/challenges/{id}/verify` vs runtime private account login/dispatch | Private routes independently default-off; invalid BFF key denied before downstream calls (`test/private-account-runtime-only-route-boundary.test.ts`) | Product decides public OTP contract; security approves OTP provider, rate limiting, private ingress, independent feature switches and browser BFF contract | OPEN |
| P0 | Design `POST /requests`, `GET /me/requests`, `POST /requests/{id}/complete` vs runtime `/account/requests*` | Frontend cross-role registered request lifecycle E2E exists (services-front PR #209); backend runtime shapes tracked here | Approve explicit customer contract mapping and DTO/status/auth parity; exercise same versioned contract against migrated PostgreSQL through browser BFF | OPEN |
| P0 | Runtime `GET /admin/moderation/cases` and `POST /admin/moderation/cases/{id}/decision` | Real HTTP read auth regression; live HTTP/PostgreSQL revoked-grant mutation regression (`test/admin-moderation-read-network-http.test.ts`, `test/admin-decision-network-http-grant-revocation.test.ts`) | Decide whether both remain private/internal; verify privileged BFF, network ingress, MFA session issuer, CSRF/origin boundary and production operator grant lifecycle | OPEN |
| P1 | Runtime `DELETE /auth/sessions/{id}` vs design account session operations | Real HTTP/PostgreSQL account isolation and immediate session revocation (`test/account-session-network-http-e2e.test.ts`) | Product approves contract/exposure, client request and response DTO/status parity; security signs off browser session handling and CSRF boundary | OPEN |
| P1 | Runtime `POST /me/professional-profiles/{id}/publish` and profile moderation/search | Frontend publication-to-search E2E exists (services-front PR #208) | Approve design operation, account permissions and moderation state/status/DTO; verify actual consumer contract version and deployed private/public exposure | OPEN |
| P1 | Runtime guest completion challenge/confirm routes | Route inventory established, not an independently accepted public API contract | Review guest capability proofs, replay/idempotency, OTP abuse limits, response redaction and browser BFF wiring before exposure decision | OPEN |

**Review completion rule:** each row is closed only after (1) a named product
decision on design ownership, (2) a named security decision on exposure and trust
boundary, (3) consumer-facing DTO/status/error/auth parity evidence with a linked
passing test/run, and (4) the approved change reflected in the docs OpenAPI and
versioned contract fixtures. Keep unresolved rows OPEN even when CI is green.
The static baseline remains **65 design / 46 runtime / 29 shape matches** and
the strict top-level acceptance count remains **29/117** until independently approved.
