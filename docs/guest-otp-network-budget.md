# Guest OTP network budget — trusted ingress + transactional PostgreSQL

This change adds **a third quota layer** for issuing guest OTPs:
recipient (existing), global (existing) and now **network**.

Network limits: **5 per rolling minute, 20 per hour, 50 per 24 hours**.
The PostgreSQL `guest_otp_network_issuances` ledger stores **only a
keyed 64-character hexadecimal network digest**; never raw IP address,
personal contact, forwarded proxy headers, OTP or bearer capability.
Network quota is serialized with a PostgreSQL advisory transaction lock.
The lock order is global → network → recipient, and the ledger record
is inserted in the same transaction as the guest contact/challenge.
Failed downstream provider sends remain counted. A rejected send cannot
create a charge or challenge.

## Important trust boundary

The OTP issuance controller requires a signed
`X-Services-Network-Proof` header **even when its opt-in flag is enabled**.
If missing, expired, tampered or the 32-byte signing secret
`GUEST_NETWORK_ATTESTATION_KEY` is absent, the route fails closed
before dispatching an OTP.

The proof format is:

`v1.<64-hex-network-digest>.<unix-time-in-milliseconds>.<64-hex-HMAC>`

The HMAC-SHA256 message is
`services-otp-network:v1\\n<digest>\\n<timestamp>`.
The proof is accepted only within ±30 seconds.

**The API never uses untrusted X-Forwarded-For or X-Real-IP.**
A separately reviewed ingress must remove all user-supplied
`X-Services-Network-Proof` headers, determine the real network address
through its configured trusted-proxy chain, derive a privacy-safe keyed
digest, and sign it with a secret shared only with the Backend.
Never sign an arbitrary IP supplied directly by the browser.
The attestation does not replace private ingress access controls,
delivery-provider limits or identity verification. Keep the OTP HTTP
feature flag off until this integration is implemented and exercised.

A future first-party BFF must not invent or forge a network proof. If
the deployment has no trusted edge identity, OTP issuance remains
unavailable. Internal unit uses of `issueCreateRequest` without the
optional digest are not public network requests and must not be
wired to HTTP without passing this mandatory controller boundary.

## Migration, rollback and operations

The independent SQL migration
`20261104_guest_otp_network_budget` creates the quota ledger and two
indexes. It is an infrastructure-owned SQL table, intentionally not
mapped through the Prisma domain model. The initial migration remains
immutable. Existing PostgreSQL 16 CI applies the additional migration
using `prisma migrate deploy`. The table should be purged by a reviewed
maintenance job after the maximum 24-hour window plus an operational
margin. Do not run destructive TTL cleanup while live quota transaction
locks are held. Validate data residency and the right to store even
keyed network identifiers in the target jurisdiction.

**Remaining launch gates:** deployment-controlled trusted edge signer,
periodic cleanup/metrics, realistic IPv4/IPv6/NAT/proxy abuse tests,
OTP provider spend caps, secure web BFF routes, contact recovery and
end-to-end notifications/cancellation. Do not enable public OTP yet.
