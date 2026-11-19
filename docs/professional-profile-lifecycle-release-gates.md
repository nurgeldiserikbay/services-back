# Professional profile lifecycle: implementation gates

Status: implementation gap analysis, not a new product policy or release approval.
Design sources: services/docs/ru/02-identities-lifecycle.md, services/docs/domain/invariants.md and contracts/openapi.yaml.

## Current runtime
- GET and POST own profiles, PATCH with owner-scoped strong version precondition.
- Database supports DRAFT, PUBLISHED, PAUSED, ARCHIVED; version and about added by forward migration.
- Public catalogue/profile readers currently require PUBLISHED.
- PATCH changes the owner draft fields only; public snapshot is separate. The new forward migration records immutable content history on snapshot capture. No owner publication/rollback HTTP workflow or legal erasure procedure is enabled.

## Required sequence
1. Resolve published revision model and minimum publication completeness with product/security owners. Preserve public snapshots and separate draft changes from published content.
2. Resolve paused catalogue semantics: lifecycle design says discoverable but no new requests, whereas current public endpoint contract says published only. Do not silently widen public access.
3. Design profile transition transaction with owner/session verification, profile version lock, idempotency scope, audit, active request/assignment guards and concurrency with request creation.
4. Add missing HIDDEN and PENDING_DELETION only with reviewed transition rules. ERASURE requires approved retention, anonymization, legal hold, export and cancellation process; do not implement by deleting rows.
5. Separate moderation override from owner transitions. Archive preserves reviews; restoration cannot bypass moderation or publication completeness.
6. Test duplicate profile creation and competing lifecycle/request commands with committed independent PostgreSQL clients, then cross-repository BFF/browser integration. Keep staging/production activation gated.

## Acceptance matrix
| Action | Intended transition | Blocking dependency |
|---|---|---|
| publish | draft/hidden/paused to published | minimum completeness, approved published snapshot, moderation |
| pause | published to paused | request guard and public visibility policy |
| hide | published to hidden | visibility and request guard |
| archive | published/paused/hidden to archived | active order handling, audit and restore |
| restore | archived to draft or published | revalidation and retained identity |
| request_deletion | retained to pending deletion | legal policy, active order workflow |
| cancel_deletion | pending deletion to allowed previous state | verified owner, policy window |
| erase | pending deletion to erased | legal approval and retention/anonymization |

No lifecycle HTTP endpoint is enabled by this document. Existing unique identity constraint remains intact.

## Prepared gated publication API (2026-11-18)
- `POST /v1/me/professional-profiles/{id}/publish`, `SERVICES_ENABLE_PROFILE_PUBLISH=enabled` only. **Must remain disabled by default and in production until product, legal and security owners approve activation.**
- Owner-only active bearer, locked row and strong If-Match version, exact empty JSON request body, no implicit replay.
- Conservative minimum: nonblank title (3+ chars), about (20+ chars), at least one published offer; only DRAFT or PUBLISHED. PAUSED/ARCHIVED rejected.
- Successful command bumps version, updates public snapshot, and creates an immutable revision and append-only audit row in the same transaction.
- Remaining launch blockers: moderation hold lookup/override, active requests and assignments guard, legal and product publication completeness decisions, committed-client concurrency proof, actual HTTP/PostgreSQL test, frontend UX and runtime metrics.
- Do not treat this code path as permission to enable publication in a deployed environment.

## Conservative runtime blockers (prepared, not approved)
- Fail closed when an unresolved `professional:{uuid}` moderation case exists (`state <> closed`); `closed` does not prove positive approval.
- Fail closed when an own seller/performer service request is `PENDING` or `ACCEPTED`.
- Both checks execute in the publication transaction after the owner profile row is locked, before snapshot and audit writes.
- **Not concurrency-safe for inserts from independent request-creation transactions without shared locking.** Product owner must also approve which active status, assignment and moderation resolution semantics permit a publication. Keep `SERVICES_ENABLE_PROFILE_PUBLISH` disabled.

## Service assignment conservative publication guard (2026-11-18)
- Publication refuses any `service_assignments` row for the owner professional in `PROPOSED` or `ACCEPTED` state, even if no pending/accepted service request exists.
- Query executes after the owner profile row is locked and before public snapshot and audit writes. Unexpected or missing database response fails closed.
- An assignment becoming `REVOKED` is not itself a moderation approval or permission to override other restrictions.
- **Activation remains blocked:** product/security approval of moderation resolution, seller eligibility, transition policy, and synchronization of concurrent assignment creation are still outstanding. Do not enable publication flags.

## Assignment versus publication serialization (2026-11-18)
- Forward migration adds a PostgreSQL trigger on `service_assignments` inserts/reactivation (and professional re-assignment) that locks the referenced professional row `FOR SHARE`. The publication transaction already locks the same row `FOR UPDATE` before checking for `PROPOSED` or `ACCEPTED` assignments.
- Assignment creation/reactivation and publication cannot pass each other without observing the serialized committed state. This does not change permitted business transitions or authorize publication.
- Remaining launch gates: positive moderation decision model, seller eligibility, production DB concurrency exercise and cross-repository E2E acceptance. Publication flags remain disabled.

## Append-only moderation decision evidence (2026-11-18)
- `professional_moderation_decisions` is an append-only database record of `APPROVE` or `REJECT`, tied to an exact professional profile version, closed matching case, and actor platform-admin staff ID. Database trigger enforces case scope/type/state and current version under row locks, and rejects later edits/deletes.
- **This is evidence storage only.** No public or privileged HTTP endpoint can create a decision through this change; no existing `closed` moderation case is retroactively treated as an approval. Publication remains default-off and is NOT permitted to infer approval from the table until a separately reviewed decision workflow enforces active MFA, `moderation.decide` grants, scope, idempotency, audit, revocation and appeal semantics.
- Decision retention and legal hold rules require separate product/legal approval. Never insert fabricated approvals in production.

## Prepared privileged decision endpoint (2026-11-18)
- `POST /v1/admin/moderation/cases/{id}/decision` with exact `{profile_id,profile_version,decision}` body is **default-off** behind `SERVICES_ENABLE_PLATFORM_MODERATION_DECIDE_HTTP=enabled`.
- Requires server-to-server admin bearer, live active user/staff/activated MFA (15-minute freshness), exact `professional:{profile_id}` grant and role `owner/admin/operator`. Origin-bearing browser mutation requests are rejected.
- Under a PostgreSQL transaction, rechecks current grants/session/factor under row locks; requires case `state='decision'` and exact profile version, atomically closes the case and records one immutable APPROVE or REJECT decision. Only exact same-actor, same-version, same-decision replays succeed; other duplicates conflict.
- **Do not enable** until approved moderation workflow, appeal handling, admin BFF origin/CSRF controls, observability and staging E2E are complete. It is NOT connected to professional publication authorization.

## Publication requires version-matched positive moderation (2026-11-18)
- The owner publication transaction checks for a closed professional moderation case with immutable **APPROVE** evidence for exactly the locked draft version. A case marked `closed` without an APPROVE decision, a prior-version approval, or any competing `REJECT` for that draft version fails closed before snapshot/audit writes.
- A reviewer decision locks the same professional row `FOR SHARE` that publication locks `FOR UPDATE`. A current draft edit increments the version and invalidates older approval evidence. Retrying publication requires a new explicit decision for the edited version.
- This guard does not approve the production rollout, seller eligibility rules, appeal semantics, or staging end-to-end acceptance. The independent moderation decision and publication feature flags remain default-off.

## Appeals and moderation-case/publication serialization (2026-11-18)
- Creating a non-closed professional moderation case, or re-opening/retargeting one, takes a PostgreSQL `FOR SHARE` lock on an existing target profile. Owner publication takes `FOR UPDATE` on that same row, so a newly opened appeal cannot slip into the publication check under an older snapshot.
- Once a case has an immutable APPROVE/REJECT decision, its resource, subject and state cannot be changed. An appeal must be a **separate** open `professional:{uuid}` case: the preexisting publication guard rejects it while state differs from `closed`.
- These constraints do not define who may file or resolve an appeal, appeal deadlines, seller eligibility, retention, or visibility transitions. Keep all publication and moderation decision flags OFF until product/legal/security and staging E2E sign-off.

## Owner rejected-decision appeal intake (2026-11-18)
- Default-off `POST /v1/me/professional-profiles/{id}/appeals` requires active owner bearer, strong `If-Match` equal to the current profile version, and exact `{"decision_id":"uuid"}` body. `SERVICES_ENABLE_PROFILE_APPEALS=enabled` is required, but MUST remain off until independent approved appeal policy and browser CSRF BFF exist.
- Only a matching immutable `REJECT` decision in a closed professional moderation case can be appealed. New `appeal` case records its link in append-only `professional_moderation_appeals`, with foreign keys, unique original decision, exact owner and profile version validated by DB triggers. The original decision is never mutated. No raw reason/contact data is accepted.
- Repeat same-owner same-decision submissions return the existing case. Concurrent duplicates may produce a unique violation; no second case can commit. Previously open moderation cases conservatively block new intake.
- Opening an appeal blocks publication under the open moderation guard. This is **intake only**, not an approved appeal review, adjudication or public release workflow. Appeal deadlines, reviewer separation and appeals resolution need legal/product/security policy and staging E2E before activation.

## Owner-only appealable rejection lookup (2026-11-18)
- Prepared default-off `GET /v1/me/professional-profiles/{id}/appealable-rejection` using the existing `SERVICES_ENABLE_PROFILE_APPEALS` flag. Authenticated owner session is checked in a DB transaction and an owned profile row is locked `FOR SHARE`.
- Response is strictly minimal `{profile_id,profile_version,decision_id}` when a current-version immutable REJECT decision is eligible; `null` means no eligible decision. Does not expose staff identity, moderation evidence, contact data or reason. Foreign profile IDs remain 404.
- Cases with prior appeal intake or any unresolved professional moderation case are not eligible. This read is advisory; the POST intake transaction revalidates all conditions, so a stale lookup grants no authority.
- **Not approved for production:** moderation appeal time windows, owner notification and legal review, browser BFF/CSRF and complete staging test evidence remain mandatory.

## Separate appeal adjudication gate (2026-11-18)
- The generic `POST /admin/moderation/cases/{id}/decision` MUST reject cases recorded in immutable `professional_moderation_appeals`, regardless of whether their current state has since been moved to `decision`.
- An appeal cannot use the same initial decision path to bypass reviewer separation, initial actor exclusion, statutory timing or appeal outcome semantics. A separate audited endpoint and policy review are still mandatory.
- If the appeal evidence lookup fails or returns a malformed row, the generic decision transaction fails closed. Publication and appeals remain disabled in production.

## Database guard for appeal decision evidence (2026-11-18)
- Forward-only PostgreSQL migration disallows ordinary `professional_moderation_decisions` INSERT for any case linked in immutable `professional_moderation_appeals`, even when an appeal case is later marked closed. This protects the database boundary, not only the admin HTTP handler.
- The regression exercises raw SQL insertion against a closed, linked appeal and expects SQLSTATE `23514` with no first-instance decision created.
- A separate, reviewed, independently staffed appeal adjudication model, policy and evidence schema remain outstanding; this does not authorize adjudication or production rollout. All publication and appeal feature flags remain off.

## Appeal intake replay and triage state (2026-11-18)
- Exact-owner duplicate POST returns the prior receipt only while the linked moderation case remains in `appeal` state. The existing case and immutable link are locked and checked together.
- If triage already moved the case to another state, the same POST returns a conflict rather than an incorrect `state: appeal` receipt; no second case is created. A separate reviewed adjudication path remains necessary.
- Activation flags remain OFF pending policy, reviewer independence, CSRF/BFF, and staging E2E.

## Prepared independent appeal outcome evidence (2026-11-18)
- A separate immutable `professional_moderation_appeal_decisions` table permits one `UPHOLD_REJECTION` or `OVERTURN_REJECTION` evidence record per appeal. The original `professional_moderation_decisions` evidence is never rewritten.
- PostgreSQL checks matching original immutable REJECT, reviewer staff ID distinct from initial decision actor, a matching **closed** appeal case, and the exact current professional profile version. SQLSTATE `23514` blocks invalid insertions. Rows cannot be updated/deleted, and a decided appeal moderation case cannot subsequently be reopened, retargeted or rewritten (including a no-op state update).
- This is **prepared evidence storage only**, not an API or authorization mechanism. An overturn never grants publication. Independent reviewer authority/MFA, decision workflow, appeals outcome semantics, time windows, audited notifications, staged concurrency E2E, legal/product/security review and BFF/CSRF remain open. All profile publication/moderation/appeal feature flags must remain disabled.

## Prepared appeal adjudication transactional core (2026-11-18)
- Internal `decideProfessionalAppeal` requires an owner/admin role with a distinct `moderation.appeal.decide` permission, exact profile resource grant, a live unrevoked session and fresh activated MFA; all authority is rechecked under PostgreSQL row locks.
- Requires a typed immutable original REJECT, a reviewer distinct from its actor, matching profile version and a case in `decision`; closes the case and writes exactly one immutable independent outcome within the caller's transaction. Exact same reviewer/outcome retries return a receipt; conflicting retries reject.
- **Not wired into HTTP, service or feature flag**. No browser caller, public status, publication decision, or automatic profile visibility is activated. Policy approval, independent reviewer allocation, appeal time limits, audit/notifications and end-to-end staging review remain pending.

## Prepared independent reviewer allocation gate (2026-11-18)
- Forward-only `professional_appeal_review_assignments` evidence binds exactly one appeal to a reviewer and an assigning staff member. All three identities (original rejecting actor, assigning staff, and reviewer) must be distinct. Allocation requires an active appeal/decision case and the same current profile version; changes/deletions are rejected.
- The internal appeal adjudication transaction now requires the authenticated staff actor to match the immutable allocated reviewer; PostgreSQL also blocks direct outcome inserts without a matching allocation. A valid scope grant and MFA without allocation do not authorize adjudication.
- **Prepared data model only:** there is no reviewer assignment API or approved operational assignment policy. The table is not a permission to manually approve cases. Actual assignment authority, legal appeal windows, notifications, HTTP/CSRF and staging sign-off remain open; no production feature flag may be enabled.

## Prepared scoped reviewer assignment transaction (2026-11-18)
- Internal `assignProfessionalAppealReviewer` requires a separate `moderation.appeal.assign` operation, owner/admin role, an explicit `professional:{profileId}` grant, live admin bearer and activated MFA verified within 15 minutes. Session, factor, staff, user and grant are rechecked under row locks inside the caller's transaction.
- The selected reviewer must have an active owner/admin staff account, activated TOTP factor and matching scope grant; the reviewer, assigning staff and original REJECT actor must be three different identities. Profile version and pending appeal case are locked and checked before inserting immutable evidence. Exact replay by the same assigning staff/reviewer returns the prior allocation; conflicting allocation is rejected.
- No assignment endpoint or UI is enabled. Assignment is prepared internal transaction logic, not an approved reviewer-allocation policy or permission to activate appeals. Cross-session concurrency acceptance, appeal time windows, operational audit, notifications, BFF/CSRF and legal/product/security staging sign-off remain open.

## Prepared appeal audit events (2026-11-18)
- Forward-only `professional_appeal_audit_events` stores minimal append-only `REVIEWER_ASSIGNED` and `APPEAL_DECIDED` metadata, with source-linked appeal ID, acting staff ID, reviewer ID, outcome only for decisions and transaction-time timestamp. No contact data, decision reason, tokens or other PII is copied.
- PostgreSQL `AFTER INSERT` triggers record reviewer allocation and final outcome in the same transaction; event insert guard rejects fabricated events without matching source evidence, and UPDATE/DELETE guards forbid later changes. Any audit insert error rolls back the triggering assignment/decision transaction.
- Database/test evidence is not a complete production audit acceptance: privileged DB controls, legal retention, log/export access, independent reviewer allocation policy, approved appeal workflow, browser BFF/CSRF, notifications and staging E2E remain required. Publication and appeals flags must stay disabled.

## Audit rollback fault-injection acceptance (2026-11-18)
- PostgreSQL integration regression injects a temporary failing audit INSERT trigger within a savepoint, independently for reviewer assignment and appeal adjudication. Both prepared commands must reject the failure; rollback to the savepoint leaves no orphan reviewer assignment, closed case, outcome or audit record.
- After the fault injection is removed, the original transaction completes and the existing audit/immutability/replay assertions still apply. This establishes a transactional database failure boundary only, **not** two-connection concurrency acceptance, browser BFF/CSRF coverage, audit retention approval or authorization for production use.

## Independent committed-client adjudication race proof (2026-11-18)
- The fail-fast PostgreSQL CI test creates an explicitly **committed** eligible appeal in disposable `services_test`, then executes adjudication on two distinct database connections with separate transactions. The first closes the appeal but holds its transaction; the second must be observed waiting on a PostgreSQL lock and can complete only after the first commits.
- Identical second request yields the same receipt without an additional decision or audit event. Conflicting outcome retry rejects, original profile remains DRAFT, and an uncommitted decision is not visible to an independent observer. Audit contains one reviewer assignment and one decision event.
- This covers concurrent adjudication plus replay, not cross-service browser/admin E2E, authorized HTTP exposure, reviewer reassignment workflow, legal retention or policy approval. The committed fixture is restricted to the disposable CI database. Related production flags remain disabled.

## Independent committed-client reviewer assignment race proof (2026-11-18)
- A fail-fast PostgreSQL integration test uses two separate committed allocation transactions and a third observer in disposable `services_test`. The first assignment is uncommitted while the second request starts; the second must be observed waiting on the case lock and can only replay after the first commits.
- The identical replay returns the original receipt; a different eligible reviewer is rejected and cannot replace the immutable allocation. Only one reviewer assignment and one matching audit event remain; case stays in `appeal` and profile remains `DRAFT`.
- This is a database concurrency acceptance, not approval to enable privileged assignment HTTP, public publication, reviewer policy or production flags. Operational retention, HTTP origin/CSRF/BFF and staging end-to-end reviews remain open.

## Prepared, NOT registered private admin appeal HTTP transport (2026-11-18)
- Two isolated controller/service candidates for reviewer allocation and independent decision, with distinct environment gates `SERVICES_ENABLE_PLATFORM_APPEAL_ASSIGN_HTTP` and `SERVICES_ENABLE_PLATFORM_APPEAL_DECIDE_HTTP`, both off unless explicitly enabled. Neither controller/service is added to the application module or registered for production: there is **no new live endpoint**.
- Each candidate rejects browser-origin and cross-site metadata, non-UTF8/non-JSON content types, noncanonical admin bearer proof and disabled feature flags before any database query. When trusted transport is authorized in a future approved rollout, the service dispatches only to the existing transaction-scoped, fresh-MFA, exact grant, assigned-reviewer and immutable-audit cores.
- The isolated Nest HTTP regression validates deny-before-DB responses and no-store/noindex headers. Unsupported non-UTF8 charset and malformed JSON are rejected by Nest body parsing before the controller runs. Prepared, **not production-registered** HTTP middleware normalizes unsupported JSON charset to safe 415 ahead of body parsing, and a separate four-argument Express error handler normalizes malformed JSON to 400 after Nest parser registration. The isolated HTTP test asserts unsupported charset 415 and malformed JSON 400 without reaching database queries. Deployment still requires deliberate scoped filter wiring and staging verification. None of these checks establish an approved BFF/CSRF browser contract or authorization to enable either flag. Independent policy, legal review, notifications, audit retention, staged HTTP+DB acceptance and module registration remain explicit blockers.

## Isolated appeal HTTP plus PostgreSQL transaction acceptance (2026-11-18)
- The private, **unregistered** admin appeal controllers are mounted only in a disposable Nest integration test with a PostgreSQL transaction. Two separate fresh-MFA scoped admin sessions simulate an independent reviewer and the assigning admin. Both HTTP flags are tested default-off independently.
- The HTTP regression exercises self-allocation denial, exact profile version, one immutable reviewer allocation, independent reviewer restrictions, triage state gating, final overturn, exact replay, conflicting outcome rejection, two immutable audit events and unchanged DRAFT publication state.
- This proves request-to-DB behavior in an isolated integration fixture only: no production controller/module registration or feature activation. Full deployed staging, legal retention, BFF/CSRF, notification delivery and approved operating policy remain open.

## Prepared parser error normalization (2026-11-18)
- The optional `PlatformAppealHttpErrorFilter` recognizes a small allowlist of body-parser error types (malformed JSON, unsupported charset/encoding, too-large payload, aborted or invalid-sized requests), returns corresponding 4xx with sanitized body, no-store and noindex headers, and preserves framework `HttpException` status codes. Unknown exceptions deliberately remain 500 without internal exception details.
- Regression mounts the filter **only in an isolated Nest HTTP fixture**, asserting invalid charset yields 415 and malformed JSON yields 400 without database access. Neither the filter nor the private appeal controllers are registered in the production module. Staged gateway/body parser configuration and an approved BFF/CSRF policy remain required before activation.

- **Ordering constraint:** the private-route `privateAppealCharsetPreflight` middleware must be attached before Nest initializes its JSON parser. Exception filters alone cannot intercept every pre-controller parser failure; production wiring and gateway validation remain blocked until approved.

- **Error pipeline ordering:** register `privateAppealCharsetPreflight`, a scoped Express JSON body parser, and `privateAppealParserErrorMiddleware` in that order **before** Nest `app.init()`/`app.listen()`. Nest's own parser may handle errors before post-init Express middleware can intercept them; Nest exception filters alone may not see parser failures. Both handlers are limited to the prepared private appeal routes and are NOT wired into production.

## Prepared private appeal transport browser-provenance hardening (2026-11-19)
- Both unregistered appeal mutation controllers now share a strict private transport check rejecting any Origin, Referer, Cookie, Sec-Fetch-Site, Sec-Fetch-Dest or Sec-Fetch-User header, including empty or `null` values. It also rejects navigation or unknown Sec-Fetch-Mode values. Node server-side fetch may emit `Sec-Fetch-Mode: cors`, so that value alone is NOT treated as browser identity or proof of safety.
- Only canonical JSON content types (with optional UTF-8) pass the transport precheck. Admin bearer, session expiry, scoped role/grant and fresh MFA remain independently mandatory in the service/database. No cookies are accepted by these private handlers.
- This is **not a BFF or CSRF implementation**. Client-settable headers cannot authenticate a caller, browsers and proxies vary, and a future browser-facing BFF must enforce its own approved origin/CSRF/session controls before server-to-server forwarding. Both appeal HTTP controllers remain unregistered with flags disabled; deploy/staging validation and policy approval are still required.

## Prepared read-only appeal audit projection (2026-11-19)
- Internal transaction-only `readProfessionalAppealAudit` returns only immutable action metadata for a single exact appeal and profile: event kind, actor staff ID, reviewer staff ID, optional decision outcome and UTC timestamp. No submissions, contact details, tokens, TOTP data, evidence text or unbounded listing are returned.
- An owner/admin/**auditor** with explicit profile scope, activated MFA within 15 minutes, an active nonrevoked session and account may read. Staff role, session, scope grant and factor are freshly revalidated with database row locks. Operators are denied, including when they hold an explicit scope grant. Wrong-profile queries and missing appeals are denied without cross-profile data disclosure.
- Regression uses real PostgreSQL and checks positive scoped auditor access, wrong profile, missing appeal, malformed ID, operator role, stale MFA, revoked token and withdrawn grant. This is **not a production HTTP read endpoint**; audit export, minimum-necessary access governance, retention periods, legal review, deployed staging and BFF/CSRF remain explicitly unapproved.

## Prepared private appeal audit HTTP GET (2026-11-19)
- An isolated, **unregistered** GET `/v1/admin/moderation/appeals/:id/audit?profile_id=<uuid>` candidate delegates solely to the scoped read-only audit core. Feature flag `SERVICES_ENABLE_PLATFORM_APPEAL_AUDIT_READ_HTTP` defaults off and must not be enabled without formal release approval. No production application module imports either class.
- Private transport rejects Origin, Referer, Cookie, Sec-Fetch-Site/Dest/User and navigation metadata. Noncanonical admin bearer proofs and disabled flags reject without database access. No-store, noindex, no-referrer and nosniff response headers are enforced.
- The isolated HTTP test covers deny-before-DB only; it is **not** a browser BFF/CSRF contract, deployed staging acceptance or approval of legal retention and audit exports. The underlying PostgreSQL role/grant/MFA tests are separately required before considering activation.

## Isolated private audit HTTP plus PostgreSQL authorization acceptance (2026-11-19)
- The existing disposable Nest + PostgreSQL transaction lifecycle fixture now mounts the unregistered audit read controller alongside assignment and adjudication. A separate `auditor` identity with scoped grant, fresh MFA and admin-only session proves read-only HTTP receipt after immutable decision, including bounded event projection and no-store headers.
- Independently default-off audit GET denies browser origin/cookie/bad bearer and wrong-profile or missing appeal without disclosing audit data. Live operator role, stale MFA, revoked session and revoked scope fail closed. Restoring valid role/session/grant permits reading again without mutation.
- This is isolated HTTP/DB E2E, **not deployed staging**, not a browser-facing BFF/CSRF approval and not authorization to enable the HTTP routes. Audit retention/export governance and release approval remain open.

## Prepared, unregistered appeal BFF CSRF contract (2026-11-19)
- `issueAppealBffCsrf` and `assertAppealBffCsrf` provide an isolated CSRF proof contract for a **future browser-facing BFF only**, not a registered controller. A 256-bit server-held HMAC key signs a random 128-bit nonce plus a 10-minute issuance timestamp, authenticated browser-session ID, exact appeal ID, privileged operation (assignment/decision), and exact allowed HTTPS origin.
- Mutating BFF requests must already have a verified browser session and must supply exact `Origin`, `Sec-Fetch-Site: same-origin`, `POST`, canonical JSON, and a valid matching CSRF header token. Wrong session, appeal, operation, origin, expired/future/forged token, non-JSON, missing cookie-authentication proof, and cross-origin contexts fail closed.
- **Not yet implemented:** safe issuance/transport of the browser CSRF token, session lookup and rotation, authentication cookie flags (Secure/HttpOnly/SameSite), origin allowlist provisioning, rate limits, proxy header trust, upstream platform admin bearer isolation, revocation/CSRF key rotation, actual BFF route and deployed integration tests. BFF CSRF by itself never authorizes review decisions: the existing admin DB scope/MFA/independence gates remain mandatory. Public and private appeal routes must remain disabled until formal security review and staging approval.

## Prepared session-to-CSRF BFF coordinator (2026-11-19)
- Internal `executeAppealBffMutation` is a prepared **unregistered** server-side coordinator. It accepts an opaque cookie proof (format checked), uses a trusted injected `resolveSession` adapter to obtain a freshly validated, unrevoked browser session ID and a **server-held** platform admin bearer, checks the previously prepared per-session/action/appeal/origin CSRF HMAC, then calls a trusted injected server-side executor. Browser input cannot supply the admin bearer, session identity, scope, role or MFA result.
- Rejection tests cover missing/invalid cookies, revoked or rotated sessions, malformed admin proof, forged/stale/wrong-action CSRF, cross-origin/unsafe method and invalid appeal IDs. Session rotation invalidates old CSRF and requires a fresh token. The executor must still enforce fresh admin MFA, profile scope, three-party independence, DB transaction and audit.
- **Not a production BFF implementation:** real browser-session issuance and database resolver, cookie attributes, rate limits, CSRF delivery/header binding, reverse-proxy trust boundaries, secure upstream bearer storage, token rotation, deployable route registration and staging HTTP+DB validation remain unimplemented/unapproved. The prepared coordinator cannot be mounted until those adapters and security acceptance are complete; publication and appeal feature flags remain disabled.

## Prepared atomic one-use BFF CSRF claim (2026-11-19)
- The **unregistered** `executeAppealBffMutation` now requires an injected `claimCsrfProof(sessionId, sha256(proof), expiresAt)` adapter after verifying the live session and HMAC. A missing adapter, duplicate proof, or claim-store error must never reach the privileged executor. Tests cover repeated, simultaneous and unavailable-store mutation attempts.
- The adapter **must implement a shared, atomic claim** (unique database constraint or Redis SET NX with suitable durability), scoped to the authenticated session and proof digest. A process-local cache/check-then-insert is not sufficient. Expiry is a cleanup hint only; accepted proof must remain claimed for at least the entire original 10-minute token validity period. A claimed proof remains consumed if execution fails; clients need a fresh CSRF proof and an independent business idempotency key to safely retry.
- **No real replay store, distributed-staging proof, browser session provider, production route or release activation is included.** Existing profile-grant, fresh MFA, independence and database authorization remain authoritative. Do not enable browser or privileged appeal routes before security and legal sign-off.

## Prepared shared Redis replay-claim adapter (2026-11-19)
- The unregistered `createAppealBffRedisCsrfClaim` uses a shared Redis-compatible `SET key 1 NX PX <ttl>` primitive. Its key is a SHA-256 digest of the server-authoritative session ID and already-hashed signed proof; the key does not expose a cookie, bearer or raw CSRF token. Claims are atomic across all BFF workers that share the same Redis database. The retention boundary covers the last valid token millisecond.
- Regression verifies competing workers, separation by session/proof, TTL boundary, malformed/expired inputs, unavailable Redis and unexpected responses. This is a mocked Redis contract test, **not** a live multi-process Redis staging E2E.
- Production Redis connectivity, TLS/auth/ACL isolation, failover and eviction policy, retention under memory pressure, operational monitoring, real session issuance and deployed BFF integration must still be approved. Configure the Redis instance for persistence/availability appropriate for security replay claims; do not use an evicting cache shared with disposable workloads. No route or feature flag is activated by this adapter.

## Real Redis one-use CSRF integration gate (2026-11-19)
- CI now starts an isolated Redis 7.4 service alongside PostgreSQL. A separate test speaks RESP over independent TCP connections, exercising simultaneous SET NX PX claims, rejection of repeated signed-proof digests, separate session/proof claims, and TTL release on a real Redis instance. This uses a test-only protocol client; no application Redis credentials or transport adapter are registered.
- A successful CI run demonstrates real single-instance Redis atomicity in the test environment, **not** cross-node failover durability, restricted production ACL/TLS, persistence, staging acceptance, browser cookie/session lifecycle or security sign-off. Keep appeal browser routes unregistered and default-off until all release gates are met.

## Prepared authenticated appeal BFF CSRF issuer (2026-11-19)
- The unregistered `issueAppealBffCsrfForSession` coordinates same-origin POST issuance from a live, server-resolved opaque browser session. It refuses invalid/revoked sessions, untrusted cookie shapes, invalid appeal/action and foreign origins before signing, and returns only a one-time candidate CSRF proof plus no-store response-header instructions. It never returns a session ID, privileged bearer or signing key.
- Regression covers valid issuance/verification, cross-session invalidation, revoked/invalid session and malformed origin/cookie/action/method. This is **not** a registered issuance endpoint or deployable browser authentication flow. Dedicated cookie/session issuance and rotation, deployment response-header enforcement, session revocation storage, rate limiting, origin/proxy trust, secure key provisioning and real browser staging E2E remain mandatory. Production flags remain disabled.

## Issuer-to-mutation real Redis CI integration (2026-11-19)
- Extended the existing Redis 7.4 CI integration test to combine the prepared same-origin CSRF issuer, live injected session resolver, server-only admin bearer, verified mutation coordinator and Redis SET NX claim. Concurrent reuse of a single issued proof results in exactly one privileged executor invocation; a later duplicate is rejected. A freshly signed proof for a revoked session is also rejected before claim/execution.
- This remains an **isolated in-process coordinator test with real Redis**, not a registered browser HTTP endpoint, cookie issuance, real privilege execution, or deployed staging validation. Real browser-session storage and rotation, TLS/ACL-protected Redis, operational failover, rate limiting, complete HTTP and DB E2E, security review and staging sign-off remain open. Production appeal flags remain disabled.

## Prepared BFF raw cookie boundary (2026-11-19)
- An unregistered helper `extractAppealBffSessionCookie` requires a single exact `__Host-services-appeal-session` value from an unparsed Cookie header. It rejects missing/duplicate names, malformed pairs, control characters, non-opaque values and overlong headers before any session lookup. It must never accept a pre-parsed cookie map that silently collapses duplicate names, and must not percent-decode the session proof.
- The `__Host-` prefix alone does not guarantee browser cookie flags: the future HTTPS response must actually issue `Secure`, `HttpOnly`, `Path=/`, no `Domain`, an approved `SameSite` policy and expiration/revocation controls. Real session storage, proxy trust, route registration and staging HTTP integration are still unimplemented. This helper does not activate any route or satisfy production acceptance.

## Prepared raw Cookie to BFF coordinator integration (2026-11-19)
- An unregistered server-only adapter binds raw `Cookie` header parsing to both authenticated CSRF issuance and mutation. Duplicate or ambiguous cookies are rejected before session lookup; the adapter passes only the extracted opaque session proof rather than trusting parsed cookie maps, browser-supplied identifiers or admin bearer values. Regression covers positive issuance/one-use mutation and duplicate, case-variant, quoted, malformed or missing raw headers.
- This is **not a registered HTTP controller or production session deployment**. Reverse-proxy header trust, duplicate Cookie header handling at the HTTP adapter boundary, real session issuance/revocation, rate limiting, Redis failover, auth-grant/MFA DB and deployed staging E2E remain open. Keep production appeal routes disabled.

## Prepared secure browser session cookie response policy (2026-11-19)
- The unregistered `buildAppealBffSessionSetCookie` and clear-cookie helpers specify a single exact `__Host-services-appeal-session` cookie with `Secure`, `HttpOnly`, `Path=/`, `SameSite=Strict` and no `Domain`. Issuance accepts only an opaque server-generated value and a bounded integer `Max-Age` of 1–3600 seconds; no request-controlled header fragments or CRLF are allowed. Clearing uses the same attributes with `Max-Age=0`.
- The helpers do **not** create authenticated sessions or prove that the session expires when its cookie does. Logout must independently revoke the authoritative session; cookies can be stolen before expiry. Deployment must enforce HTTPS, approved session TTL policy, signing/storage, rotation, revocation, MFA and grant checks, Set-Cookie header semantics, and staged HTTP/browser acceptance. Production appeal routes stay unregistered/default-off.

## Prepared authoritative appeal BFF logout coordinator (2026-11-19)
- An unregistered server-only `logoutAppealBffSession` helper demands a same-origin POST and a single strictly parsed raw `__Host-services-appeal-session` cookie. It **awaits an authoritative durable session revocation** (caller-supplied storage adapter) before returning a secure clear-cookie header. False or uncertain revocation results are denied, storage faults propagate, and no cookie clearing is represented as server revocation.
- Tests verify revocation ordering, malformed/cross-origin/repeated-cookie denial before revocation, failure-closed storage behavior and no CSRF issuance or privileged appeal mutation after session revocation using a shared injected session resolver.
- This remains a prepared coordinator with **no actual session database/revocation adapter, session issuance, route registration or deployed HTTP logout**. Production sign-off still requires durable revocation transactions across workers, replay and race/failover E2E, HTTPS/cookie header enforcement, MFA/grants, security and staging acceptance. Keep privileged appeal browser flags disabled.

## Logout exact trusted origin validation (2026-11-19)
- Prepared logout now rejects missing, malformed, path-bearing, non-HTTPS or credential-bearing configured origins even when an attacker-controlled request-origin field matches. It requires an exact separately configured HTTPS origin before raw Cookie parsing or authoritative revocation. Regression tests require no revocation on these invalid origins.
- The origin must originate from trusted server deployment configuration, never browser-controlled headers or untrusted proxy forwarding. This remains an unregistered coordinator; full staging browser, session storage and policy review remain open.

## Prepared opaque browser session issuance boundary (2026-11-19)
- The unregistered `issueAppealBffBrowserSession` creates a fresh 32-byte CSPRNG opaque browser cookie token, derives a domain-separated HMAC-SHA256 server-side hash using a separate 32-byte pepper, and calls the injected `persistAuthorizedSession` adapter with only the hash and bounded expiry. The secure `__Host-` cookie is returned **only** after the adapter confirms an authorized committed write. Missing/unsafe TTL, invalid key, rejected insert or uncertain COMMIT fail closed. The response contains no admin bearer or stored hash.
- The injected storage adapter is **not implemented** in production: it must transactionally validate the authenticated privileged principal, current MFA/grants, session quotas and expiry, and insert a new browser-session mapping that resolves to server-only admin authority. This helper cannot establish these guarantees by itself; use no browser-supplied principal/session IDs. Actual database schema, hash lookup, session logout/revocation, secret rotation, recovery/retention, cross-worker concurrency and staging HTTP/browser E2E remain open. No BFF route or flag is activated.

## Prepared hashed BFF browser session lookup (2026-11-19)
- The unregistered `createAppealBffHashSessionResolver` accepts only a canonical opaque browser proof, derives an appeal-BFF-domain HMAC using its dedicated pepper and sends **only that hash** to the authoritative storage lookup. It rejects absent/malformed/expired/revoked sessions and does not even query privilege authority until the browser session row is valid. Server-authoritative, freshly resolved admin bearer must have canonical format; storage/authorization outages propagate and never fall back to local memory.
- Test fixtures validate canonical HMAC lookup, expiry boundary, revocation, malformed store rows, invalid admin bearers and failing storage/privilege lookups. Production adapters are **not implemented**: transactionally maintained session records, instant revocation visibility across workers, MFA/staff/grant checks at every use, secure bearer custody, TTL cleanup, secret rotation, key management, concurrent races and staging HTTP E2E are still open. Neither a controller nor a production route is registered.

## BFF async authority expiry recheck (2026-11-19)
- The unregistered hashed browser-session resolver rechecks its expiry against a new clock sample **after** the asynchronous privileged-authority lookup, refusing a session that expired while awaiting a DB/network operation, or whose clock source moved backward/produced an invalid value. Regression asserts exact expiry boundary and clock anomalies.
- This does not make two separate reads of session and privileged authority transactional. Production adapters must provide authoritative transaction isolation / revocation visibility and reauthorize MFA/grants at each privileged mutation; security review, HTTP staging E2E and route registration remain open.

## Prepared browser session PostgreSQL storage boundary (2026-11-19)
- An unregistered PostgreSQL adapter `createAppealBffPgSessionStorage` uses parameterized hash-only `SELECT` and conditional `UPDATE ... revoked_at=now() ... RETURNING` for a **future, separate** `platform_admin_appeal_browser_sessions` table. Both queries enforce PostgreSQL clock expiry and null revocation. A real PostgreSQL CI regression tests active/expired/revoked hashes and conditional multi-claim behavior on a connection-local TEMP table; it never modifies deployed platform tables.
- **Not yet a production store or migration**: the target table is not created in the canonical schema by this PR. The production migration, authorized session issuance transaction and staff/MFA/grant custody, HMAC pepper management, consistent DB transaction semantics, concurrent workers, HTTP integration, staging E2E and security acceptance remain required. Raw browser proof must never be saved or queried. Production appeal routes remain disabled.

## Migrated PostgreSQL table for appeal BFF browser sessions (2026-11-19)
- Added a distinct Prisma model and migration for `platform_admin_appeal_browser_sessions`, with UUID primary key, privileged staff foreign key, unique CHAR(64) browser-token HMAC hash, bounded lifetime timestamp, optional revocation timestamp, created timestamp and (staff,expiry) index. There is no cookie plaintext or privileged bearer column. Real migrated PostgreSQL CI introspects columns, uniqueness and foreign-key constraints without writing a privileged session. The prepared hash-only storage adapter is still unregistered.
- **Schema presence does not authorize session issuance or deployment.** A server-only transactional issuance adapter must validate current staff status, MFA, grants, age/session caps, and not persist admin bearer material. Production revocation must be visible across workers; add key rotation, expiry cleanup, audit, CSRF/session HTTP E2E and failover tests before enabling any BFF route. The appeal browser flow remains disabled.

## Prepared PostgreSQL authorized browser-session admission (2026-11-19)
- An unregistered `createAppealBffPgAuthorizedSessionInsert` adapter uses a single parameterized `INSERT ... SELECT` to write a hash-only browser-session record **only** when an existing platform admin session is active, unrevoked, within its expiry, has recent activated TOTP MFA, an active user and enabled owner/admin staff, and an explicit matching server-determined scope grant. The new browser-session expiry cannot exceed the platform admin session or a one-hour bound. Admin bearer never reaches SQL plaintext: its separate HMAC domain hash is used. Failures, invalid parameters, ambiguous results and database outages deny issuance.
- This is a prepared security boundary, **not** a registered endpoint, transactional session handoff guarantee or complete production admission process. Concurrent changes in admin revocation/grants/MFA may race the statement's read snapshot; further locking/transaction isolation, trusted session provenance and scope selection, auditing, per-staff caps, full real-DB positive/negative fixtures, key rotation, expiration cleanup and staging browser security acceptance remain open. Production BFF route flags stay disabled.

## Real PostgreSQL appeal BFF session admission matrix (2026-11-19)
- The prepared browser-session `INSERT ... SELECT` now has an isolated real-PostgreSQL permission matrix in CI. It uses connection-local TEMP shadow tables and verifies a successful hash-only insert; denies admin-session revocation/expiry, browser expiry beyond admin expiry, stale MFA, disabled TOTP factor, missing scope grant, disabled staff, auditor role and suspended user. It then restores valid authority and demonstrates successful issuance. No production users, grants or browser sessions are inserted by this test.
- This tests the current authorization predicate but **does not** settle revocation-vs-issuance races, prove READ COMMITTED lock ordering, implement live bearer custody, or activate production BFF. Locking design, real schema E2E and per-operation MFA/grant revalidation remain review gates.

## Authorizing admin session row lock during BFF issuance (2026-11-19)
- The prepared, unregistered browser-session `INSERT ... SELECT` now uses PostgreSQL `FOR SHARE OF auth` on its authorizing `platform_admin_sessions` row. The lock lasts through the insertion statement/transaction; concurrent revocation `UPDATE` or deletion of that same row must respect the lock. The existing real PostgreSQL positive/denied matrix executes the amended query, and unit coverage asserts the lock is present.
- This is **not** a full cross-worker race/linearizability proof. The query has not yet established lock ordering with modifications to staff status, user suspension, TOTP factor or grants. A dedicated two-connection revocation race test with reviewed transaction boundaries, session custody, audit and deployed HTTP acceptance is still required. Routes remain disabled.

## Two-connection PostgreSQL BFF admission vs revocation lock regression (2026-11-19)
- New isolated real-PostgreSQL integration launches **two database clients** with distinct transactions over a dedicated per-test schema, exercises both serial orders: (a) admin-session revocation UPDATE gets the row lock first, the blocked browser-session `INSERT ... SELECT FOR SHARE` resumes only after COMMIT and must deny insertion; (b) browser-session insertion gets the row SHARE lock first, the concurrent revocation UPDATE blocks until the issuance transaction COMMIT, then applies revocation. `pg_blocking_pids` checks real database contention instead of relying on timing assumptions. The test drops its own schema and never touches platform tables or real administrator records.
- The race proof covers only the admin-session row; it **does not imply cascade revocation** of previously issued BFF browser sessions or close concurrent staff, TOTP, grant changes. Production BFF still needs session invalidation on upstream revocation, key custody, audited transaction patterns, HTTP routes, failover and staging browser E2E. All browser endpoints remain default-off.

## Parent-bound appeal BFF browser sessions (2026-11-19)
- Each browser BFF proof now carries a required `admin_session_id` foreign key to the **exact** `platform_admin_sessions` row authorizing its issuance. The prepared `INSERT ... SELECT` writes `auth.id` server-side, never accepting a browser-supplied parent ID. The hash lookup joins that parent, the matching staff, and the current user; it fails closed if the parent is revoked/expired, staff disabled, or user suspended. No reliance on another unrelated live admin session for the same staff member. Migrated PostgreSQL schema checks assert the required FK/index, and isolated DB tests exercise parent revocation and expiry.
- **This does not yet complete browser-session revocation propagation to all consumers**: any other adapter/route must resolve via the parent-validating lookup, and privileged mutations still need fresh MFA/scope enforcement. The parent session's TOTP/staff/grant changes, race isolation, bearer custody, new-session quotas, staging E2E and security approval remain launch gates. No browser HTTP route is registered or enabled.

## Fresh per-use BFF browser session MFA and grant gate (2026-11-19)
- An unregistered `createAppealBffPgScopedSessionLookup` provides a parameterized, scoped read path for the exact parent admin session. The BFF hash is accepted only with a live browser and parent session, active owner/admin staff and user, current MFA within 15 minutes, active TOTP factor and an explicit scope grant. A real PostgreSQL temporary-table matrix checks that grant removal, stale MFA, disabled TOTP, role downgrade, parent revocation and browser revocation deny the next lookup. A malformed token or scope is rejected before SQL.
- **Not a registered route or complete production authorizer:** the caller must supply a server-trusted resource scope; action execution still needs in-transaction reauthorization and correct revocation race isolation. Existing generic `findSessionByHash` cannot replace this scoped gate for privileged operations. Bearer custody, key rotation, session quotas, audit, staging HTTP/browser E2E and deployment approval remain open.

## Unified BFF configured-origin preflight (2026-11-19)
- Unregistered BFF CSRF issuance, mutation and logout now share one strict canonical HTTPS origin validator. It rejects missing `expectedOrigin` even when both request and expected origins are undefined/equal, and rejects HTTP, credentials, paths, query, fragments, malformed DNS labels, noncanonical hosts/ports and invalid port ranges before session or revocation adapters. The expected origin must come from a trusted server-side configuration, not Host, Origin, Forwarded or browser input. CI runs negative fixtures across all three coordinator entrypoints.
- This is only a prepared server boundary. The HTTP adapter must independently pass a trusted configured origin, honor proxy TLS deployment and verify same-origin browser headers. Endpoint activation, end-to-end authentication/session custody, CSRF replay storage and staging browser verification remain release blockers.

## Per-appeal BFF scoped request composition (2026-11-19)
- Prepared, unregistered `createAppealBffPerAppealSessionResolver` now ties a specific appeal/action to a trusted server-side `resolveAppealScope` callback, then validates the raw opaque browser cookie via the BFF HMAC domain, scoped PostgreSQL session lookup and an independent server-held privileged bearer provider. Two unregistered wrappers compose this with existing strict raw Cookie, canonical HTTPS origin, CSRF issuance and one-use mutation claim flows. No browser-supplied scope, role or bearer is accepted; a different appeal cannot inherit another appeal's scoped authorization. Regression tests cover wrong appeal, revoked grant, revoked session, malformed Cookie and absent origin.
- This only wires **prepared** adapters. The production `resolveAppealScope` must query authoritative appeal/profile state and ensure action-specific scope mapping; the final privileged database transaction must still authorize staff, MFA, grants, reviewer assignment and case state at commit. Real HTTP route mapping, secret custody, replay storage configuration, audit and staging E2E remain blockers. No BFF endpoint enabled.

## PostgreSQL appeal-to-case BFF scope authority (2026-11-19)
- A prepared, unregistered `createAppealBffPgAppealScopeResolver` now supplies the missing server-authoritative appeal-to-scope mapping for the BFF scoped-flow composition. Parameterized lookup joins `professional_moderation_appeals.case_id` to `platform_moderation_cases.id`, requiring the moderation case's `resource_scope` to match `professional:` plus the appeal's stored profile UUID. Unknown appeal, wrong action, absent moderation case, or case pointing to a different profile fail closed. Isolated real-PostgreSQL integration covers exact and cross-profile mappings, altered case scope and absent rows; no production data is changed.
- This adapter is **unregistered**. Action-specific transaction authorization must still revalidate staff, case/assignment, grant and MFA at commit; choosing a scope from an appeal is not permission to perform an action. Endpoint implementation, secure bearer custody, durable replay handling, staging browser E2E, rate limits and launch approval remain incomplete. Routes remain disabled.
