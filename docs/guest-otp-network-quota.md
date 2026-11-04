# Trusted network OTP send quotas — deployment-gated

Guest OTP **issuance** now requires a trusted network assertion at
`POST /v1/guest-requests/challenges`, in addition to the existing
disabled-by-default route switch, global budget and per-recipient limits.

## Required edge contract

A trusted ingress/gateway (NOT a browser or ordinary forwarding header)
must determine the authentic client network after validating its own proxy
chain. It then makes a non-reversible, keyed HMAC bucket identifier for an
approved network grouping (such as a reviewed IPv4/IPv6 prefix policy);
never persist the original IP. The authenticated ingress signs the exact
assertion

`v1.<unix_epoch_milliseconds>.<64-lowercase-hex-network-digest>.<64-lowercase-hex-signature>`

where the signature is HMAC-SHA256 with the dedicated 32-byte
`GUEST_TRUSTED_NETWORK_ASSERTION_KEY` over UTF-8 bytes
`guest-network-assertion:v1\\0<timestamp>\\0<network_digest>`
(the backslash-zero separators represent NUL bytes).

- The gateway must strip any client-supplied
  `X-Services-Trusted-Network`, `Forwarded` and
  `X-Forwarded-For` before calculating its own identity.
- Only the trusted gateway may supply `X-Services-Trusted-Network`
  to backend; block direct bypass of ingress at the network layer.
- The backend verifies signature with constant-time comparison and
  rejects missing, malformed or older/newer than 30 seconds.
- Never expose the signing key to browsers, third parties or logs.
  Use a distinct secret from contact encryption or OTP HMAC.
- Configure a high-availability gateway identity scheme: independent
  browsers must not be allowed to pick their own bucket; rotating a
  bucket on each request would defeat the limits.
- The signed assertion is deliberately unavailable from the current
  Frontend BFF adapter: integrating a reviewed gateway is still required.

## PostgreSQL enforcement

Migration `20261104_guest_otp_network_quota` creates
`guest_otp_network_events` with hashed network ID, challenge ID, and
created timestamp. No raw addresses or guest contact data are stored.

Atomic issuance locks **global → network → recipient** with PostgreSQL
transaction advisory locks. Per-bucket limits: 5/minute, 20/hour,
100/24h. Failed provider deliveries do not refund the limits; only
committed challenges count. Events must be purged using a reviewed
retention job after 24h (not implemented yet).

Backend and Frontend OTP flags **remain disabled by default**.
These network limits are one layer only; an approved KZ-resident
delivery provider, spend caps, verification/replay abuse limits,
trusted ingress setup and live E2E security tests remain release gates.
