# Services Backend

Backend repository for the Services platform. Source of truth for business behavior and API contracts: [services documentation](https://github.com/nurgeldiserikbay/services).

## Intended approach
- NestJS + TypeScript; PostgreSQL; Prisma; modular monolith.
- Initial domains: identity, profiles, professions, organizations, locations, affiliations, service offers, assignments, experiences, reviews, bookings, follows, notifications, moderation and audit.
- Enforce authorization, profile uniqueness and independent review ownership in transactions and database constraints.
- API designed from reviewed contracts in the documentation repository.

## Status
Repository initialized for coordinated development. No backend implementation has been added yet.

Do not commit secrets, PII, production credentials or real customer data.
