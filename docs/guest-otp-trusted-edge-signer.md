# Trusted-edge OTP proof signer — implementation reference

The Backend already requires a signed `X-Services-Network-Proof`
for `POST /v1/guest-requests/challenges` and enforces the network
quota in PostgreSQL. This change supplies **a standalone reference**
for the ingress-side proof construction.

It does **not** mount a signer endpoint, configure a proxy, trust arbitrary
HTTP headers, or enable production OTP sending. Never import this helper
into a public NestJS controller or a browser-facing Next.js route.

## Trust boundary and deployment

A separately deployed, private, authenticated ingress/gateway must:

1. Reject direct external access to the origin/backend.
2. Drop inbound `X-Services-Network-Proof`, `Forwarded`,
   `X-Forwarded-For`, and `X-Real-IP` unless the chosen trusted
   proxy chain needs to reconstruct an address from explicitly trusted
   hops. Never accept a client-asserted identity.
3. Extract the **authenticated client network address** only after
   validating each trusted proxy hop. Call
   `signTrustedNetworkProof({authenticatedClientAddress,digestKey,
   attestationKey})` inside the gateway (not from user data).
4. Forward the newly signed `X-Services-Network-Proof` to the backend
   over authenticated private ingress. Configure backend to reject
   missing/expired proofs. Protect the shared attestation secret and
   periodically rotate it via coordinated gateway/backend rollout.
5. Apply independent transport-level rate limits and provider spend
   controls; the signed proof is an additional database quota layer,
   **not** permission to send OTPs by itself.

The signer strictly accepts canonical IPv4 or IPv6 addresses and groups
them into **IPv4 /24** or **IPv6 /64** network buckets. IPv4-mapped IPv6
forms are rejected until normalized by trusted infrastructure. These
prefixes are only **initial anti-abuse defaults**, not universal
identity guarantees: NAT/mobile clients can share one bucket, and
changing IPs can evade per-network limits. Verify fairness and
provider-abuse budgets in a realistic pilot.

## Cryptography and privacy

- `digestKey`: 32 bytes, **edge-only**, HMACs the network bucket,
  keeping raw addresses out of the quota table.
- `attestationKey`: separate 32 bytes, **edge and backend**, authenticates
  the assertion's network digest and millisecond timestamp.
- The signer emits exactly the existing backend format:
  `v1.<64-hex-digest>.<unix-milliseconds>.<64-hex-signature>`.
- Backend verifier rejects a mismatch and timestamps outside ±30s.
- Never log raw address, bucket, generated proof, secrets, OTP or contact.
- Keep signer/bucket-key and backend secrets outside user-facing code.
- Document lawful retention and KZ data residency for derived network data.

Automated tests check signer/verifier interoperability, consistent
IPv4/IPv6 grouping, separate cryptographic keys, signature tampering,
expiry and malformed/mapped address rejection.

## Remaining production gates

This PR does not provision the ingress, provider, cleanup scheduler or
full browser BFF route. Manual infrastructure validation, backend
network isolation, CDN behavior and end-to-end OTP delivery/creation
tests remain mandatory before any OTP route can be enabled.
