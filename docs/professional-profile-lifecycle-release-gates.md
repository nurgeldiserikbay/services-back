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
