# Stage 1 — Catalog and search acceptance contract

Status: implementation pending verification. This document is a delivery gate, not a claim that APIs exist.

## Minimum vertical slice
- Persist country, city, profession taxonomy, specialist profiles, organization profiles and published/hidden state in PostgreSQL via reviewed Prisma migrations.
- Public `GET /v1/search`: accept validated location, profession and text filters, stable cursor/page pagination and bounded page size. Response schema must match the canonical services API contract; reconcile contract first if divergent.
- Only published profiles and public fields are returned; never expose phone or other private details unless explicitly marked public.
- Specialists may have multiple professions and optional verified company affiliations. Company and specialist reviews remain separate.
- Prevent N+1 queries; define deterministic ordering and indexes for common filters.
- Ensure no fabricated ratings, availability or profiles.

## Acceptance tests
1. Published profile is searchable; hidden, suspended and unpublished profiles are not.
2. City and profession filters compose correctly; invalid filters return 400.
3. Stable pagination never duplicates records on unchanged dataset.
4. Tenant/role isolation and private-field redaction hold for anonymous requests.
5. Migration works on clean DB; CI runs integration tests against PostgreSQL.
6. Health check does not imply database readiness.

## Cross-repository handoff
Publish reviewed OpenAPI examples and seed fixture before frontend integration. Preserve existing work; inspect current implementation before coding.
