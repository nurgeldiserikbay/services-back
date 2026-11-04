# Guest status HTTP — explicit opt-in only

Backend `GET /v1/requests/{id}` now delegates to the existing
`GuestRequestStatusService` with an opaque `Guest-Capability` header.
The domain lookup requires a matching request ID, original contact,
unexpired/unconsumed READ_CANCEL token and a purpose-specific token HMAC.

## Safe default

`SERVICES_ENABLE_GUEST_STATUS_HTTP` must be **exactly** `enabled`.
If unset or anything else, the controller returns 404 **without performing
the database lookup**. This prevents an accidental release simply by
deploying the code. Do **not** enable on public production traffic until
the listed reviews have passed.

The response uses `Cache-Control: private, no-store, max-age=0`,
`Pragma: no-cache` and `X-Robots-Tag: noindex, nofollow`.
No browser cookie or bearer token from the URL is accepted.
The existing global CORS settings do **not** allow
`Guest-Capability` as a browser-requested header. A future same-origin
Next.js BFF must read its own protected HttpOnly cookie and forward the
proof server-to-server over TLS. No guest credentials are logged.

## Deployment requirements before opting in

- Private/internal API ingress or equivalent reviewed exposure controls.
- Threat model and network/global rate limits for status reads;
  probe/enumeration and availability testing.
- Approved KZ-resident infrastructure and secret management.
- Approved web BFF, no public token serialization, SSR/private caching audit.
- E2E checks with real PostgreSQL, expired token, other contact, cross-request
  token, gateway/CDN caching, and rate limits.
- Separate OTP provider and recovery flow for proof expiry.

Enabling this read-only endpoint **does not enable** guest OTP issuance,
POST /guest-requests, cancellation, or notification delivery.
