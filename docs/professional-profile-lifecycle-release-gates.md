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
