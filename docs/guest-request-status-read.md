# Guest request status lookup — internal READ_CANCEL service

`GuestRequestStatusService` exposes a **NestJS internal-only** query for
reading the status of exactly one guest request. It does not enable a public
HTTP route.

Access requires all of the following, enforced in one PostgreSQL query:
- A well-formed request UUID and a 256-bit opaque `READ_CANCEL` token.
- A matching purpose-separated HMAC token hash stored on that request ID.
- A capability whose `guest_contact_id` matches the request's original
  guest contact, which has not expired and has not been consumed.
- A guest-owned request (not an authenticated user's request).

Unknown, other-person, expired, consumed or malformed requests return the
same Forbidden response, without revealing that a request ID exists.
The response uses an explicit allowlist:
`{id,service_offer_id,state,version,created_at}`. It never returns
private note, guest email/phone, contact digest, seller internal IDs,
encrypted data, capability hashes or raw tokens.

## Release prerequisites

- Implement the reviewed, authenticated BFF and backend guest-status HTTP
  endpoints with HTTPS, Origin/CSRF checks for mutations and no-store
  private response semantics; never publish an unauthenticated ID lookup.
- Use the server-side `__Host-services_guest_request` request-scoped
  HttpOnly cookie and forward its proof only server-to-server.
- Reverify the original contact after 24-hour READ_CANCEL expiry. Recovery
  remains unimplemented.
- Review network-level abuse budgets, provider delivery and request status
  read observability without sensitive token/PII logs.

Tests cover the safe DTO and a real PostgreSQL lookup denying another request,
wrong guest contact, expired, consumed and random proofs. Test data rolls back.
