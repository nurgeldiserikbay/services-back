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

## Product baseline v0.6 — read before feature work
1. Canonical product blueprint: https://github.com/nurgeldiserikbay/services/blob/main/docs/ru/01-product.md
2. ACCEPTED vs OPEN decisions: https://github.com/nurgeldiserikbay/services/blob/main/docs/ru/12-roadmap-decisions.md (OPEN-01..14, TECH-01..08)
3. Implementation gates: https://github.com/nurgeldiserikbay/services/blob/main/docs/ru/22-delivery-roadmap.md
4. Owner-approved simple requests/company views: https://github.com/nurgeldiserikbay/services/blob/main/docs/adr/0003-simple-booking-company-view.md
Never implement proposed/open details as certain requirements. Do not claim implementation-ready before contract/UX/security gates.

## Owner-approved cancellation and reliability baseline v0.7 (2026-11-01)
Read https://github.com/nurgeldiserikbay/services/blob/main/docs/adr/0004-cancellation-reliability-and-defaults.md and chapter 12. Seller controls per-offer free cancellation deadline; on accepted booking with confirmed time server snapshots terms, cannot change retroactively. Cancel pending or early as client -> no penalty. Authenticated customer's late cancellation decreases separate customer reliability. Independent seller/company cancel accepted -> provider reliability of actual seller, never automatically of assigned employee. Reliability independent of quality-review stars and explainable/appealable; no automated bans or monetary fines. **On every cancellation including pending** create one confirmation to initiator and one notification to counterparty via atomic outbox, then asynchronous delivery/retries; guest via verified channel. Country-specific privacy/legal gates and API/Prisma/UX remain outstanding. Diagram: docs/diagrams/cancellation-reliability.mmd in canonical docs.

## Contract-first baseline v0.8 (2026-11-01)
Before implementing MVP APIs or UI, read:
- https://github.com/nurgeldiserikbay/services/blob/main/contracts/prisma/README.md
- https://github.com/nurgeldiserikbay/services/blob/main/contracts/prisma/schema.prisma
- https://github.com/nurgeldiserikbay/services/blob/main/contracts/prisma/constraints.sql
- https://github.com/nurgeldiserikbay/services/blob/main/contracts/prisma/test-cases.md
- https://github.com/nurgeldiserikbay/services/blob/main/contracts/api-mvp-matrix.md
- https://github.com/nurgeldiserikbay/services/blob/main/contracts/openapi.yaml
- https://github.com/nurgeldiserikbay/services/blob/main/docs/ux/mvp-screen-contracts.md
Prisma reference and SQL constraints are NOT applied migrations; OpenAPI is a design draft with documented gaps, despite passing syntax/bundle CI. Do not invent endpoints or DTO fields absent from a reviewed contract; don't claim UX approved before visual prototypes. Implement seller-scoped ACL and always queue both cancellation notifications; reliability is independent from quality reviews.

## MVP contract refinement v0.9 (auth, guest access and events)
Canonical docs: https://github.com/nurgeldiserikbay/services/blob/main/docs/adr/0005-auth-guest-sessions.md and https://github.com/nurgeldiserikbay/services/blob/main/contracts/api-mvp-matrix.md. OpenAPI uses /requests and /guest-requests (no /bookings or /guest-inquiries), supports account sign-in/sign-up by verified OTP, web HttpOnly cookie session + CSRF, mobile bearer plus rotated refresh, and single-request guest capabilities. Do not create a User when a guest verifies contact. Prisma reference now has 36 models: AccountAuthChallenge, AccountConsent, GuestCapability and generic DomainOutboxEvent were added. NotificationIntent.domainEventId is required for all request events, cancellationId optional except for cancellation; **every cancellation** still creates exactly two intent records. ServiceRequest separates seller from performer; busy blocks have explicit personal/company ownership. CI checks real PostgreSQL 16 SQL invariants, not production migrations. Avoid copying superseded 32-model schema or cancellation-only notification assumptions.

## Services UX prototype v2 baseline (2026-11-02)
Canonical preview: https://nurgeldiserikbay.github.io/services/prototype.html . Detailed human/AI mapping: https://github.com/nurgeldiserikbay/services/blob/main/docs/ux/prototype-v2-mapping.md .
CompanyProfessionalView is a distinct company-context projection of a single canonical ProfessionalProfile. Corporate embedded card always routes ServiceRequest to organization seller; independent personal page routes to professional seller. Both professional field allowlist AND company selection AND platform permission needed for visibility. UX demo includes a status page, seller inbox with accept/decline, cancellation with two simulated notifications and separate reliability. Preferred date is NOT confirmed booking time, so no automatic customer late-cancel penalty before time agreement. These demo transitions are only in-memory, no actual OTP, auth, scheduling or network notification. Build real backend ACL/DB transactions per ADR-0003/0004/0005 and actual kk/ru/local-first UX; do not copy illustrative scores as user data.
