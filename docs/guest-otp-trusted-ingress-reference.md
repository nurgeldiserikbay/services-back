# Guest OTP trusted ingress — reference contract (not a deployment)

The Nest backend currently validates a short-lived, HMAC-signed
`X-Services-Network-Proof` on the **default-off** OTP challenge issuance
routes. A backend-only verifier cannot prove the signer exists at the edge.
This document defines the separation required before staging acceptance.

## Traffic and trust boundary

1. An approved ingress terminates TLS and enforces that the Nest service is
   **not directly reachable from clients**.
2. The ingress **removes any client-supplied** `X-Services-Network-Proof`
   (and other internal capability headers) before applying authentication.
3. The ingress resolves the **authoritative client address** using
   deployment-specific, audited trusted-hop configuration. Never pass a
   user-supplied `X-Forwarded-For`, `Forwarded` or similar header directly
   into the proof signer. An unverified address lets an attacker rotate
   network identities and bypass quota attribution.
4. A signer running **only on the approved trusted edge** holds separate,
   32-byte identity-HMAC and attestation-HMAC keys. Reference:
   `src/platform/ingress/guest-otp-network-proof.edge.ts`.
   The identity HMAC turns a canonical IP into a non-reversible digest.
   The second HMAC signs the digest and millisecond timestamp in the existing
   backend `v1.<64-hex>.<timestamp>.<64-hex>` contract.
5. A private hop forwards the newly minted proof to Nest. Nest verifies the
   existing 30-second timestamp window and MAC before charging atomic network
   quota, then shared recipient/global quota and committing a challenge.
   Failed OTP delivery still consumes quotas; production provider is disabled
   until separately reviewed.

## Deployment acceptance (all pending)

- [ ] Secret-store custody and rotation for the **edge-only** identity key;
      verify it differs from attestation, guest request and contact keys
- [ ] Backend/edge attestation key distribution and rotation without logging
      values; no signing endpoint exposed to browser traffic
- [ ] Trusted proxy-hop address parsing: concrete upstream topology,
      IPv4-mapped IPv6 normalization and intentional IPv6 /64 or other prefix
      policy; test that spoofed forwarding headers cannot change digest
- [ ] Strip and replace all client-supplied internal proof/capability headers;
      direct backend access blocked by firewall/private network or mTLS
- [ ] TLS/HTTPS origin restrictions and redacted edge and backend logs
- [ ] CI/staging proof handoff with actual deployed ingress (not just a pure
      test), provider quotas, malformed headers, retry/failure, and key rotation
- [ ] Provider security approval, Kazakhstan residency assessment, operational
      owner signoff, and mobile/desktop client acceptance

`makeTrustedOtpNetworkProof` is deliberately **not imported** into
`main.ts`, controllers or browser code. Its unit tests confirm that the
reference and the existing backend verifier agree, including stale, wrong-key,
tampered and IP-parsing denials. These tests **do not** satisfy any of the
deployment acceptance items listed above. The production feature flags must
remain off until the real ingress, OTP provider and staging signoffs exist.
