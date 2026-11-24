# OTP gateway — private ingress deployment evidence and fail-closed release gate

**State: NOT APPROVED / NOT DEPLOYED.** This is an evidence checklist for infrastructure, security, KZ data ownership and operations. It does not provision a listener, select a provider, configure credentials, or authorize an OTP send. References: [provider acceptance](otp-gateway-provider-staging-acceptance.md) and [unresolved reservation handling](otp-gateway-reserved-reconciliation-runbook.md).

## Trust boundary and supported topology

```text
Trusted backend/BFF (server-side only)
  -> private ingress and allowed source network
  -> TLS termination WITH verified client identity
  -> original HTTP headers + strict body framing and deadline
  -> application-level BFF credential + signed request validation
  -> PostgreSQL durable reservation
  -> independently approved HTTPS OTP provider
```

Never expose this endpoint on the public Nest API, the browser, an ordinary administrator API or a shared catch-all reverse proxy. A forwarded header claiming a trusted source, a TLS-terminating load balancer, or a passing loopback test is **not** evidence of authenticated private ingress. If TLS terminates before the application, document and independently verify the exact peer-identity handoff, trusted hop, header stripping, hop authentication and impossibility of client-supplied spoofing. If this cannot be proved, **NO-GO**; do not silently replace the existing Node certificate verification with `X-Forwarded-Client-Cert`.

## Blocking infrastructure checks

| ID | Control / acceptance evidence | Evidence owner | State |
| --- | --- | --- | --- |
| IN-01 | KZ region, network diagrams, approved private endpoints, ingress/egress firewall and denied public reachability; include backups, logs, monitoring and failover locations | KZ data owner + network | PENDING |
| IN-02 | TLS 1.2+ policy and peer trust chain verified from a real client; server requests and rejects missing/unauthorized client certificates; approved CA distribution and certificate subject/usage validation | Security | PENDING |
| IN-03 | Approved SHA-256 client certificate pin(s), dual-pin rotation overlap, forced revocation drill and alerting before expiry; inventory of owners and rollback | Security + operations | PENDING |
| IN-04 | Document raw header provenance at every proxy hop; reject duplicate Authorization, signature and content framing fields **before** body or ledger access; enforce total header and header-count bounds | Edge + backend | PENDING |
| IN-05 | Transport socket/header/request/idle timeouts, maximum one request per connection as required by approved listener policy, maximum 1024 body bytes, cancellation of stalled or truncated requests, and connection-cap/load-shed test | SRE + backend | PENDING |
| IN-06 | Private BFF secret storage, 256-bit key custody/rotation, signed network attestation source and accepted clock skew; explicit default-off config, no permissive development bypass | Security + backend | PENDING |
| IN-07 | Database role separation (migration owner, runtime writer, read-only observer) proven against the **deployed** role and schema; TLS to DB and transaction rollback/connection disposal drills | DBA | PENDING |
| IN-08 | Provider destination allowlist, DNS/rebinding behavior, TLS server validation, secret custody and egress denial outside approved providers | Security + network | PENDING |
| IN-09 | Structured redacted telemetry for attempts, rejection reasons, reservation age and provider outcomes; no raw OTP/contact/authorization/signature/reference in traces; alerts and retention approval | SRE + privacy | PENDING |
| IN-10 | Staging isolated test contacts, provider sandbox idempotency/receipt evidence, concurrent request/restart/timeout/ACK-failure drills, reconciliation on-call owner | Provider owner + operations | PENDING |
| IN-11 | Documented rollback: disable gateway feature, block ingress/egress as needed, preserve RESERVED ledger and audit trail, do not retry unresolved sends | Incident lead | PENDING |
| IN-12 | Exact deployed artifact digest/commit, signed CI receipt, infrastructure change ticket, independent security sign-off and expiry/review date for all exceptions (blocking exceptions require NO-GO) | Release owner | PENDING |

All controls are **PENDING** until supported by actual environment-specific evidence. Localhost, disposable PostgreSQL and mocked-vendor tests are valuable regressions but cannot close any deployed-infrastructure check by themselves.

## Read-only staging monitor endpoint pinning

The operator-invoked staging observer preflight requires an **independently approved TCP port** in `OTP_GATEWAY_MONITOR_EXPECTED_PORT` as well as the existing expected host, database, role and schema. The PostgreSQL URL must explicitly contain the same port (decimal 1–65535, no leading zeroes or implicit default), and query/fragment overrides remain forbidden. This input gate is evaluated **before any connection**. Configure the port using approved restricted deployment settings, not by copying it from the untrusted URL. A successful local preflight still does not attest network source, KZ placement or a deployed mTLS gateway.

## Required negative-path drills

Perform with sandbox credentials and dedicated test recipients only; store links to restricted redacted evidence, not secrets or recipient values.

1. From the public internet, an unapproved network and a peer without a valid client certificate, connection **must not reach** request validation or ledger access.
2. From an approved network, test a CA-valid but unpinned client, a revoked pin and an expired certificate; none may claim a ledger reservation.
3. Send duplicate original HTTP security headers and conflicting framing. No proxy may merge away the duplicates before the validating boundary; invalid requests must be rejected before reading body bytes or calling the provider.
4. Stall, truncate and oversize an HTTP body. Verify enforced wall-clock deadline, destroyed transport where applicable, bounded memory and zero ledger/vendor effects.
5. Simulate database unavailability before reservation: **zero sends**. Simulate provider timeout or successful send followed by DB ACK failure: leave durable RESERVED, deny automatic replay/send, route to the documented reconciliation owner.
6. Rotate CA/pins/secret under controlled overlap, revoke old credentials and verify old clients cannot send. Test the safe default-off and incident rollback paths.
7. Confirm denied outbound traffic to arbitrary destinations and absence of secrets, PII and OTP material in logs, metrics, traces, CI artifacts and response bodies.

## Release decision record (restricted evidence links only)

| Field | Value |
| --- | --- |
| Environment / country and network change ID | PENDING |
| Source + destination topology and public reachability test | PENDING |
| Deployed artifact SHA + digest, exact-head CI run | PENDING |
| Server CA / client CA ownership, pin rotation/revocation drill | PENDING |
| Header, socket and body bounds test receipts | PENDING |
| PostgreSQL role/TLS and failure evidence | PENDING |
| Provider contract, idempotency and receipt evidence | PENDING |
| Sanitized matrix result and reconciliation on-call | PENDING |
| KZ data owner, security, SRE and provider approvers + dates | PENDING |
| Decision | **NO-GO** |

**Rule:** A single PENDING/FAILED blocking control, unverified provider guarantee, unapproved private network, missing signed evidence or expired security approval means **NO-GO**. Review must be repeated on meaningful TLS/proxy/provider/DB-role/config changes. This record cannot be used to justify checking the master acceptance register or changing runtime flags without independent observed results.
