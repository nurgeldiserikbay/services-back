# OTP gateway — provider onboarding and staging acceptance gates

**Status:** proposal, approval REQUIRED. No vendor has been selected, configured, contacted or activated by this document.

**Scope:** dedicated OTP gateway in Kazakhstan, not public Nest API, not browser, not a production migration. See `otp-gateway-reserved-reconciliation-runbook.md` and `otp-gateway-idempotency-ledger.sql`.

## 1. Provider evidence required before implementation

An owner must record the provider's **official current API documentation/version**, legal entity and subcontractors, data processing location(s), support/SLA contacts and privacy/retention terms in a restricted approval record. Do not copy credentials, personal identifiers, message contents or OTP codes into this document or CI.

| Gate | Required evidence | Blocking if absent |
| --- | --- | --- |
| Channel and purpose | Explicitly approved SMS/email routes and allowed originator/sender IDs | Yes |
| Kazakhstan data residency | Written data-flow map incl. queueing, logs, backups, failover, support access and downstream subprocessors; KZ data owner approval | Yes |
| Authentication | Server-side credential mechanism; secret rotation/revocation; egress destination allowlist; TLS certificate validation | Yes |
| Idempotency | Documented provider idempotency key scope, retention duration, duplicate semantics, concurrency and timeout outcomes; evidence keys survive gateway restart | Yes |
| Receipt authenticity | Provider's canonical accepted/rejected/unknown semantics, authenticated receipt / lookup, stable allowed-format provider reference and binding to original key | Yes |
| Ambiguous delivery | Lookup/reconciliation operation for a timed-out request; what constitutes proof of non-delivery; provider escalation route | Yes |
| Rate, expiry, cost | Message expiration, limits, backpressure, sender provisioning, pricing/cost ceiling and abuse handling | Yes |
| Security/privacy | PII redaction, OTP retention/deletion guarantees, incident notifications, logging boundaries and consent | Yes |
| Failure controls | Approved timeout and retry rules, bounded provider response size, status/content-type validation and structured redacted errors | Yes |

**Never assume that an HTTP 200 alone proves delivery**, that a timeout proves no delivery, or that a new idempotency key safely retries an unresolved delivery. If the provider cannot give an authenticated same-key lookup/receipt and defensible deduplication guarantees, block integration pending a reviewed alternative design.

## 2. Gateway adapter contract to approve

The existing `OtpGatewayVendorPort.sendOnce` is a **reference interface**, not a live integration. Any approved concrete adapter MUST:
- Be instantiated only after mTLS, upstream BFF bearer, signed payload and strict envelope validation.
- Use the gateway's durable idempotency key as supported by the provider; persist the reservation **before** making an outbound request.
- Send only allowlisted fields over HTTPS with validated server identity and restricted egress. Keep credentials and PII out of errors, metrics, URLs and tracing.
- Validate the full provider acceptance contract, including reference format, explicit acceptance state and original-key binding, before invoking ledger `recordAccepted`.
- Fail closed on malformed, truncated, oversized, untrusted, contradictory or unavailable responses. Leave `RESERVED` for reconciliation; never auto-delete, auto-reclaim or silently retry with a different key.
- Treat a successful provider response followed by a failed PostgreSQL ACK as **ambiguous**; a replay must not cause another delivery.
- Respect cancellation and deadlines where feasible without interpreting cancellation as proof of non-delivery.
- Require manual operator sign-off for provider-side recovery; do not add a public or ordinary admin reset endpoint.

## 3. Isolated staging acceptance matrix

Run against an approved **sandbox provider** with dedicated test destinations, approved egress and redacted logs. Record exact provider API revision, gateway SHA, scenario ID, observation, DB evidence, sanitized HTTP response, outbound send count and operator approval.

| Scenario | Expected gateway/ledger invariant |
| --- | --- |
| Valid BFF + mTLS + signed payload | One durable reservation precedes one provider call; authenticated acceptance becomes `ACCEPTED` with valid reference |
| Two concurrent identical signed requests | At most one outbound provider send; duplicate cannot create second accepted delivery |
| Changed signed body with same key | 409 conflict, no outbound call, no replacement of original ledger fingerprint |
| Malformed HMAC, duplicate security header or untrusted mTLS cert | Rejected before any ledger claim or provider send |
| Provider rejects, times out, disconnects or returns malformed receipt | Generic error, `RESERVED` retained, replay cannot re-send |
| Provider accepts but ledger ACK write fails | Generic error, `RESERVED` retained, replay cannot re-send |
| Initial PostgreSQL reservation fails | Generic error, **zero** provider calls |
| Gateway process restarts while reservation unresolved | Durable `RESERVED` remains; no automated resend |
| Provider same-key lookup returns inconclusive/unauthenticated evidence | No mutation or resend; manual escalation |
| Controlled CA/pin rotation, credential rotation and revoked peer | Legitimate rotation succeeds; revoked/untrusted peers cannot deliver |
| Provider outage, network partition, rate-limit and response-size attack | Bounded resources, sanitized diagnostics, no duplicate send |
| Restricted observer account attempts to write claims | PostgreSQL denies mutation; only aggregate diagnostic SELECT succeeds |

## Database writer privilege separation

The reference PostgreSQL schema must be owned by a separate, tightly controlled migration/DDL role, **not** the runtime delivery role. Runtime writer needs schema `USAGE`, table `SELECT`, column-scoped `INSERT (idempotency_key,fingerprint,status)` and `UPDATE (status,provider_ref,accepted_at)` for durable reservation and acceptance. Do **not** grant table-wide `INSERT` or `UPDATE`: immutable key, fingerprint and original claim timestamp must remain outside its write privileges. It must not own the table, own trigger functions, hold `DELETE` or `TRUNCATE` privileges, or have `CREATE` on the gateway schema. Superuser and privileged migration credentials must never be present in the runtime environment.

`test/otp-gateway-writer-role-postgres-e2e.test.ts` tests this isolation using a randomly named temporary PostgreSQL `NOLOGIN` role and separate reference schema: real `claim` and `recordAccepted` work under `SET ROLE`; immutable column mutations, destructive DML, TRUNCATE and attempts to disable/drop triggers or drop the table are forbidden. This does not provision a production credential. The infra owner must approve actual role grants, audit privileged DDL and run rotation/recovery drills.

## 4. Operational go/no-go

Before any real delivery: designated provider owner, security lead, KZ data owner and operations lead must approve the staging matrix, network ACL/egress/firewall, secrets and certificate lifecycle, provider contract, monitoring thresholds measured in pilot, reconciliation incident response and rollback/drill evidence.

**GO** only with linked passing exact gateway commit CI, approved sandbox results, provider/legal evidence, private KZ deployment attestation, on-call ownership and signed decision. **NO-GO** when any hard gate above is undocumented or unverified. Rollout must be opt-in and default-off; no production OTP vendor is configured by these reference files.

## Evidence record template (fill only with verified information)

- Provider name + official API version/documentation: **PENDING**
- Contract/privacy/KZ data-residency approval links: **PENDING**
- Security reviewer + approval date: **PENDING**
- Gateway build SHA and exact-head CI URL: **PENDING**
- Sandbox provider environment and egress approval: **PENDING**
- Matrix run logs (redacted), failure drills and database evidence: **PENDING**
- Credential and CA rotation drill, rollback result: **PENDING**
- Operations owner/on-call and reconciliation sign-off: **PENDING**
- Release decision (GO/NO-GO), approvers, timestamp: **NO-GO until evidence exists**

Related reference regression evidence: PR #408–#415 prove local/mocked gateway and PostgreSQL behavior; they do **not** substitute for provider-backed staging or production acceptance.
