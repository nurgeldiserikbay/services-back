# Guest request create HTTP — disabled by default

Backend route: `POST /v1/guest-requests`.

This controller is an adapter over the existing transaction-safe
`GuestRequestService.createFromVerifiedContact`. It does **not** issue an
OTP, trust a browser-provided contact, or decide seller ownership from the
request body. The payload is strictly
`{service_offer_id,note?,consent_to_contact:true}`; the backend resolves
seller from the canonical published offer.

## Disabled deployment default

The route returns 404 without invoking any application service unless the
deployment sets **exactly**
`SERVICES_ENABLE_GUEST_CREATE_HTTP=enabled`.
Deployments should leave this unset until the security and integration
release gates are completed. The flag is *not* authentication.

When enabled, `Guest-Capability` must contain a short-lived
`CREATE_REQUEST` proof from a separately verified guest contact.
`Idempotency-Key` must be a stable key for this logical submission.
The database transaction checks one-time proof ownership, prevents
duplicate requests, records events/notification intents and returns an
encrypted replay response. The HTTP adapter maps the committed result to
the documented snake_case response:
`{id,state:'pending',request_capability,expires_at}`.

**Important:** `request_capability` is a sensitive READ_CANCEL bearer
credential, not public profile information. This HTTP response must never
be returned unchanged to a browser. The first-party BFF must seal it
immediately into the scoped HttpOnly Secure cookie and send only
`{id,state}` to browser JavaScript. Responses include no-store,
noindex headers. The global API CORS policy intentionally does not
allow browser POST/Guest-Capability headers.

A wrong or unavailable proof/offer returns generic 403; a conflicting
idempotency key returns 409. Neither exception contains contact or token.
Existing backend validation may return 400 for malformed request bodies.

## Release gates before enabling in production

- A reviewed Kazakhstan-resident OTP delivery adapter, rate limits at
  network/device level and bounded provider spend.
- First-party browser BFF for OTP issue/verify, secure session rotation,
  CSRF/Origin enforcement, content-size limits and retry recovery.
- Restricted server-to-server ingress and audit of any reverse proxy/CDN.
  An environment flag alone must never be used as an ingress security boundary.
- Real E2E tests for successful committed requests and error/timeout
  replay, expired/consumed proof, wrong resource, notification delivery,
  secret redaction and concurrency.
- Security monitoring without logging contact, OTP, capability, request
  notes, or sensitive headers.

This PR does not enable or deploy public guest submission.
