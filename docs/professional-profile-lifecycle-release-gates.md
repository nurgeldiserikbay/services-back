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
