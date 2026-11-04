# OTP provider acceptance test and launch checklist

The full OTP flow can be tested against the existing PostgreSQL schema
without selecting or calling a live SMS/email vendor.

## Automated provider-contract integration

`test/guest-otp-provider-contract-e2e.test.ts` injects a small deterministic
`OtpDeliveryPort` fake. This is **test-only**: no real email or SMS is sent.

Its PostgreSQL integration probes confirm:
- Committed OTP challenge and encrypted guest contact before delivery.
- Quota charge for the signed-network bucket, even on provider rejection.
- Exact delivery payload for approved provider ports (locale, purpose, TTL).
- OTP code remains hashed in the database; code/destination do not appear in
  provider receipts, shared outbox payloads or HTTP outputs.
- Wrong verification code consumes an attempt without creating a capability.
- Correct verification creates one scoped CREATE_REQUEST capability.
- A consumed code cannot produce a second capability.
- Retry within the recipient cooldown does not send another message.
- Provider rejection causes the challenge to be marked consumed, and does not
  refund network quota.
- Fixtures and keyed quota rows are removed in cleanup.

The repository CI already supplies real PostgreSQL 16. These tests do
**not** establish that a commercial provider actually delivers messages.

## Requirements before selecting a production provider

- Document SMS and/or email transport, verified sender identity, KZ data
  residency, processing location, DPA/legal review, and contact retention.
- Implement provider-specific adapter behind `OtpDeliveryPort` only; do not
  change the domain issuance transaction to depend on vendor DTOs.
- Do not return provider raw errors, phone numbers, code, or credentials in
  logs or frontend payloads.
- Enforce credentials through a secret manager, strict provider HTTPS host
  allowlist, timeouts, bounded retries (never repeat unconfirmed OTP sends
  blindly), provider spend limits, and fail-closed delivery status.
- Handle delayed delivery / ambiguous acceptance safely. Provider acceptance
  does **not** mean customer received or verified the OTP.
- Validate real OTP delivery, wrong code, expiration, provider outage, rate
  limits, contact changes and device/browser flows in staging with test
  accounts and the trusted edge.
- Keep `SERVICES_ENABLE_GUEST_OTP_HTTP` and web BFF deployment gates
  disabled until ingress, CSRF, provider, spend and E2E reviews pass.

This PR adds automated evidence, not an enabled external OTP service.
