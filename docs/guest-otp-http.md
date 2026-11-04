# Gated guest OTP HTTP interfaces

This PR adds two controller adapters defined in the canonical OpenAPI draft:

- `POST /v1/guest-requests/challenges` accepts `channel` (sms/email),
  `contact` and `locale` (kk/ru); returns only `{challenge_id}` with HTTP 202.
- `POST /v1/guest-requests/challenges/{id}/verify` accepts a six-digit
  `code`; returns `{guest_capability,expires_at}` with HTTP 200 on success.

Both routes are **disabled by default**. If
`SERVICES_ENABLE_GUEST_OTP_HTTP` is not exactly `enabled`, each responds
404 before calling any application service. Flag activation is *not* a
security or identity boundary. The underlying `OtpDeliveryService`
still has **no configured provider**, so no real OTP should be delivered.

Issuance delegates to the existing transactional global/recipient quotas and
to the delivery service, which revokes an issued challenge if delivery fails.
Verification delegates to the single-use atomic challenge proof repository
and five-attempt protection. No raw OTP code, contact, OTP hash or CREATE
capability is logged by these controllers. The verify response is a sensitive
short-lived bearer proof, intended **only for the trusted BFF** to seal into
its HttpOnly CREATE_REQUEST cookie; it must never be returned to browser JS
or exposed in URLs, analytics, shared caches or ordinary UI JSON.

Response headers include `Cache-Control: private, no-store`,
`Pragma: no-cache`, `X-Robots-Tag: noindex, nofollow`.

## Unmet production launch gates

1. Approved Kazakhstan-resident SMS/email provider and delivery status checks.
2. Network/IP/device rate limiting at trusted ingress (with trustworthy
   proxy chain and privacy-safe fingerprinting), additional verification
   throttling, load tests and provider spending/alert budgets.
3. Reviewed same-origin BFF: CSRF/Origin checks, bounded request payloads,
   secure cookie rotation, retry handling, anti-enumeration and `no-store`.
4. Restricted API ingress and tests to ensure browsers cannot call direct
   capability-bearing endpoints; the existing CORS configuration prohibits
   browser POST and `Guest-Capability` headers but CORS alone is not access
   control.
5. Production-like end-to-end scenarios for challenge, delivery, verification,
   create/retry, status, recovery and notification reconciliation.

Do not enable the flag, advertise public request submissions or mark guest
bookings ready until these gates are met.
