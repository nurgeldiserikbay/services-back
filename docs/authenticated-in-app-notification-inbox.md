# Authenticated in-app notifications — bearer API

## Stage 1 — server-scoped recipient lookup

`GET /me/notifications?limit=20` accepts only a strict registered-account bearer, not cookies or client-provided person IDs. The backend checks a live, unrevoked ACTIVE account session and maps its user ID to exactly one person in the same PostgreSQL transaction used to read the private inbox. Unknown/ambiguous person mapping returns an empty list rather than widening access. The API has no-store/noindex headers, validates 1–50 limit, and returns only id, topic, subject ID and ISO timestamp.

## Stage 2 — strict separation from notification delivery

Only already-delivered IN_APP intents can be returned. An IN_APP delivery is retrievable in the recipient's inbox, not necessarily read by the recipient. Queued EMAIL/SMS notifications are not surfaced as delivered or sent. The route never exports OTP, bearer tokens, contacts, request notes, organization membership, or internal notification payloads.

## Stage 3 — PostgreSQL HTTP-level regression

Tests exercise malformed authorization, malformed query limits, distinct users/people and their isolated delivered notifications, and immediate rejection after account session revocation. No browser BFF or public anonymous API is added. To expose this to a web user, implement a server-only authenticated BFF using an HttpOnly session with CSRF and session verification; never send the backend bearer to browser JavaScript. Account OTP provider and verified login remain production prerequisites.
