# Registered account request to notification acceptance test

This PostgreSQL transaction regression spans the complete **internal** journey for two registered accounts, without relying on developer-only bypass sessions or fake in-memory persistence.

1. Seller and customer each verify a provider-confirmed SIGN_IN account OTP, creating two distinct hashed, revocable sessions. The test simulates delivery confirmation **inside its database transaction only**; it does not expose an endpoint that accepts public delivery acknowledgements.
2. A seller with organization membership accepts a registered customer's PENDING service request via the authenticated idempotent decision transaction. Replaying the same key produces the same decision without a duplicate notification. Acceptance does not fabricate a calendar slot.
3. Outbox staging and IN_APP materialization produce one durable recipient-scoped delivery. The authenticated customer notification controller retrieves only the customer's safe DTO; the seller sees none. Customer logout invalidates the inbox bearer immediately, while the seller remains unaffected.

The fixture runs under BEGIN/ROLLBACK to leave CI data clean. The test verifies the internal connected business logic; it is **not** a real browser E2E and does not supply an approved SMS/email vendor, public account login routes, signup consent, native push or production scheduler. Real browser login and delivery must remain gated until independent provider, anti-abuse, ingress, origin/CSRF and security review work is complete.
