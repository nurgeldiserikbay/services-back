# AGENTS.md — Backend

## Source of truth
The canonical human + AI specifications are in https://github.com/nurgeldiserikbay/services, also readable at https://nurgeldiserikbay.github.io/services/ . Read the following before implementation:
- docs/ru/13-functional-catalog.md (requirement IDs)
- docs/ru/15-permissions-matrix.md (ACL)
- docs/ru/16-state-machines.md (valid transitions and concurrency)
- docs/ru/17-database-design.md (domain data)
- docs/ru/18-api-design.md (API conventions)
- docs/ru/20-backend-implementation.md (your architecture)
- docs/ru/22-delivery-roadmap.md (phase and dependencies)
- docs/ru/23-quality-tests-release.md (test cases)
- docs/ru/25-ai-development.md (agent workflow)
- docs/ru/26-acceptance-checklist.md (release criteria)
- contracts/openapi.yaml (partial draft; not complete production SDK contract)

## Shared invariants
- One professional profile per canonical profession per person, including archived/hidden/draft states.
- Professional reviews stay with the professional; organization/location reviews stay with their own immutable targets.
- Affiliation with company and assignment to each particular company service are separate and consensual.
- Separate public and private identity data and maintain per-resource authorization.
- Preserve history for bookings, reviews, affiliations and audits through lifecycle changes.

## Backend specific
- NestJS + TypeScript, Prisma, PostgreSQL; modular monolith. Explicit transaction boundaries, unique constraints and resource-level authorization.
- Core modules: identity, persons, professional profiles, taxonomy, organizations, affiliations, service offers/assignments, bookings/experiences/reviews, page builder, notifications, moderation, audit/outbox.
- Never implement new business policy directly in controllers, DTOs or Prisma middleware. Domain transition tests and real PostgreSQL integration tests required.
- Implement API only after reviewing docs/ru/18-api-design.md and draft contracts/openapi.yaml; coordinate breaking changes before generating typed clients.
- Prevent duplicate profiles for a canonical profession; reviews retain immutable target; affiliations never grant automatic assignment to every company service.

## Collaboration & quality
Use feature branches / PRs in parallel work unless the owner explicitly requests main. Check existing code and shared components before creating duplicates. Small cohesive changes, proper tests, lint, types, CI. Sync API/domain changes with services docs first. Never commit secrets or customer PII. Never claim a feature works on Android/iOS or staging unless actually tested. Do not merge a PR without owner instruction.

## Global local-first discovery
See https://github.com/nurgeldiserikbay/services/blob/main/docs/adr/0002-global-local-discovery.md and GEO-01..10 in chapter 13. Domain geography is global from day one (country/area/city stable IDs, service delivery modes/coverage, offer currencies/timezones); search is local-first by chosen/approximate region and anonymous public APIs. IP hints are inaccurate, never override manual choice. No automatic precise geolocation, no public leakage of private address or guest IP. Global schema does not imply all regulated services can operate in every jurisdiction.

## Overall system diagrams
Before implementing a feature, inspect the visual overview diagrams and their editable Mermaid sources: https://github.com/nurgeldiserikbay/services/tree/main/docs/diagrams . Business overview, seller-controlled inquiry flow, and technical architecture clarify ownership, permissions, responsibilities, and shared API boundaries. The authoritative domain rules remain the corresponding Markdown specification chapters.

## Owner-approved booking simplification (2026-11-01)
IMPORTANT PRODUCT OVERRIDE: https://github.com/nurgeldiserikbay/services/blob/main/docs/adr/0003-simple-booking-company-view.md. Simple status model pending/accepted/declined/cancelled/completed, no Quote or price negotiation. Resolve seller from service-offer and verified source_context; independent profile request belongs to professional, embedded company card to company. CompanyProfessionalView is two-sided field permission intersection over a single ProfessionalProfile. Support voluntary calendars, personal/company AvailabilityAllocation and private busy-block conflict checks. SavedItem scoped to customer, accurate aggregated registered-client metrics. Prior draft status enums or price snapshots are superseded.
