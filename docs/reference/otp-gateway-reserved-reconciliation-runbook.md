# OTP gateway unresolved reservations — operator runbook (draft)

**Status:** documentation only, NOT an approved procedure or a production deployment.
**System:** separately hosted OTP gateway PostgreSQL ledger (not the Services application database).
**Owner/sign-off required:** security lead, KZ infrastructure/data owner, OTP provider owner, incident commander.
**Related:** `docs/reference/otp-gateway-idempotency-ledger.sql`, `src/platform/ingress/otp-gateway-postgres-ledger.reference.ts`.

## Safety invariant

A `RESERVED` row means the gateway durably claimed the idempotency key, but cannot prove whether the external OTP provider delivered the message. Timeouts, process death, invalid provider acknowledgements and failed acknowledgement writes are **ambiguous outcomes**.

**Never** automatically delete, expire, reclaim, re-key or reset a `RESERVED` row to trigger another send. Never change `fingerprint` or `idempotency_key`; never use a new key to replay an unresolved OTP. A retry of the same key must remain `in_flight` / HTTP 409. An altered signed payload under that key must remain `conflict` / HTTP 409.

No raw OTP, destination, access token, HMAC secret, client certificate private key or full request payload belongs in this ledger, operator report or logs.

## Optional manual aggregate report (reference-only)

An authorized operator may run `scripts/otp-gateway-reservation-report.ts` **only** from an approved private gateway operator session using a dedicated, tightly scoped PostgreSQL credential supplied through `OTP_GATEWAY_MONITOR_DATABASE_URL` by the secret manager. It requires explicit `--read-only` and never runs as part of the Services app or CI deployment. Example: `node --import tsx scripts/otp-gateway-reservation-report.ts --read-only`.

The reference CLI additionally requires `OTP_GATEWAY_MONITOR_CA_PEM`: the PEM-encoded, **operator-approved dedicated gateway database CA** supplied by the secret manager. It sets `ssl.ca`, `rejectUnauthorized: true`, and minimum TLS 1.2 on the PostgreSQL pool. The operator connection URL must use `postgresql://` or `postgres://`, include a hostname/user, and contain **no query parameters or fragment** (notably no `sslmode`, `sslrootcert`, `sslcert`, or `sslkey`): pg URL parsing can otherwise override the explicit TLS object. The reference configuration now also parses every certificate in the bounded PEM CA bundle and rejects non-CA, malformed, not-yet-valid, or expired certificates before connecting, as well as `NODE_TLS_REJECT_UNAUTHORIZED=0` (process-wide TLS verification bypass). Certificate chain and hostname checks are performed when the connection opens. This preflight is not a certificate rotation system, a revocation check, or production acceptance. Do not disable certificate verification, use a placeholder CA, commit a private key, or interpret this reference guard as evidence that real TLS/secret rotation/private KZ network acceptance is complete.

The manual CLI checks database role privileges and reads the aggregate using **the same pinned PostgreSQL session in a `BEGIN TRANSACTION READ ONLY` / `ROLLBACK` block**, then **destroys the one-shot pooled connection** instead of returning any `SET ROLE` or transaction state to the pool. This prevents separate pooled queries from accidentally running with different session identities, and asks PostgreSQL to reject writes even if a role is configured incorrectly. It still requires a separately approved TLS configuration, private networking, secrets management and schema isolation.

The manual CLI now requires both `OTP_GATEWAY_MONITOR_DATABASE_URL` and the **trusted, operator-approved** `OTP_GATEWAY_MONITOR_SCHEMA` (lowercase PostgreSQL identifier, not `pg_*` or `information_schema`). Inside the pinned read-only transaction, it applies a parameterized `SET LOCAL` search path with that schema ahead of `pg_temp`, checks the resolved ledger's namespace matches the configured schema, and fails closed if it does not. Never derive this schema name from an untrusted HTTP request, the current database search path, or a user-supplied OTP value.

Before reading any metrics, the operator report also verifies that the unqualified gateway ledger name resolves to an **ordinary persistent PostgreSQL table**, not a temporary table or view inserted earlier in the session search path. This is a fail-closed relation-integrity check, not a replacement for explicit schema pinning and controlled database ownership in staging/production.

Before any count is fetched, the report checks the database's **current role privileges**. It refuses table owners or broad roles with any INSERT/UPDATE/DELETE/TRUNCATE access, as well as roles able to SELECT idempotency keys, fingerprints, receipts, or acceptance timestamps. Only `SELECT(status,claimed_at)` is permitted. The returned JSON contains only aggregate counts and the oldest claim timestamp, never row identifiers or OTP payloads; SQL errors are sanitized. This is a **defense-in-depth preflight**, not a replacement for audited grants, TLS validation, secret rotation, KZ residency controls, DDL role isolation or owner approval. Do not expose the CLI output as a public endpoint or schedule it without a reviewed operations process.

### Local TLS protocol evidence (not staging approval)

`test/otp-gateway-monitor-tls-handshake.test.ts` uses a disposable localhost PostgreSQL SSLRequest-speaking test peer and ephemeral OpenSSL CA/server keys inside a temporary directory. It exercises the actual `pg` TLS negotiation: trusted CA and DNS hostname complete the handshake; an unrelated CA and a hostname mismatch must not complete an authenticated handshake. The peer deliberately closes before database authentication and therefore **does not prove real PostgreSQL credentials, queries, production certificate rotation, mTLS, KZ private network boundaries, or OTP provider staging acceptance**. Keys are generated in the CI runner and never committed. The local test additionally switches the test peer to a newly issued server certificate signed by a different CA: the original CA pin must fail, while the new pin and an explicitly provided, bounded overlapping CA bundle permit a verified PostgreSQL startup packet. This exercises a controlled cutover protocol, **not** live certificate renewal or credential rotation. During a real rollout, the infrastructure owner must plan trust-bundle overlap, server certificate issuance, deployment ordering, rollback, audit and eventual old-root removal; never disable hostname verification to recover connectivity. Only owner-approved staging tests against the real private gateway endpoint can close those acceptance gates. The protocol suite also presents a **historically expired server leaf certificate** signed by an otherwise valid trusted test CA, verifies its validity dates, and requires the monitor to reject it without sending an authenticated PostgreSQL startup packet. This is a deterministic local negative test, not a real production certificate-expiration or renewal exercise.

## 1. Detect and contain

1. Confirm the alert belongs to the **dedicated** OTP gateway database and identify the deployment, environment, owner and timestamp without copying credentials.
2. Validate gateway clock, database health, audit trail, network status and the provider's current outage notices.
3. Pause affected gateway outbound delivery if suspected duplicate sends, unauthorized access or provider contract failure are observed. Do not stop unrelated notification channels without an incident decision.
4. Verify RBAC: read-only investigator access is distinct from emergency operations approval. Use approved secure access, not a public SQL endpoint.

For staging verification, `test/otp-gateway-reservation-health-postgres-role-e2e.test.ts` creates a temporary NOLOGIN PostgreSQL role with only schema USAGE and table SELECT in a disposable isolated schema, invokes the aggregate health reader under `SET ROLE`, and asserts UPDATE/DELETE/INSERT are rejected with insufficient privilege. This is **test-only proof**, not a provisioned production role or a credential management policy. An authorized infrastructure owner must provision and review the real SELECT-only account separately.

The monitoring role should receive **schema `USAGE` plus column-scoped `SELECT (status,claimed_at)` only**, not table-wide `SELECT`. This supports the aggregate diagnostic while preventing direct reads of idempotency keys, fingerprints, provider references or acceptance timestamps. The real PostgreSQL role test verifies forbidden column reads return SQLSTATE `42501`; deployable role provisioning still requires infrastructure approval.

For a read-only count, from a controlled operator session with **SELECT-only** access:

For a consistent one-shot operator view, `readOtpGatewayReservationSnapshot` returns the unresolved total, oldest timestamp and all age buckets from **one PostgreSQL aggregate statement**, sharing a single MVCC statement snapshot and database `now()`. It requires only the same column-scoped SELECT rights and fails closed if the totals disagree, a timestamp is malformed, or future-dated claims make the buckets incomplete. Do not combine separate read results as if they were necessarily from the same database instant; do not expose this function as a public route or use it for automatic OTP retries.

The optional reference helper `readOtpGatewayReservationHealth` (`src/platform/ingress/otp-gateway-reservation-health.reference.ts`) executes an aggregate-only query returning `{unresolvedCount, oldestClaimedAt}`; it contains no HTTP endpoint, deployment, claims manipulation or automatic retry logic. Supply a dedicated read-only PostgreSQL role; do not expose the returned diagnostic through a public API. The unresolved count is a decimal string to prevent loss of precision for large PostgreSQL `count(*)` values.

```sql
SELECT count(*)::bigint AS unresolved_count,
       min(claimed_at) AS oldest_claim_at
FROM otp_gateway_delivery_claims
WHERE status = 'RESERVED';
```

The reference helper `readOtpGatewayReservationAgeBuckets` implements this read-only age histogram using the same column-scoped `SELECT(status,claimed_at)` observer role. It reports exact decimal-string counts for **under 5 minutes**, **5 minutes to under 1 hour**, and **1 hour or older**, plus a total; inconsistent aggregate counts fail closed. These windows are *diagnostic buckets only*, never a retry trigger, expiry policy or adopted SLO.

For an age-bucket summary without exposing any idempotency keys:

```sql
SELECT
  count(*) FILTER (WHERE claimed_at >= now() - interval '5 minutes') AS recent_count,
  count(*) FILTER (WHERE claimed_at < now() - interval '5 minutes'
                     AND claimed_at >= now() - interval '1 hour') AS middle_count,
  count(*) FILTER (WHERE claimed_at < now() - interval '1 hour') AS older_count
FROM otp_gateway_delivery_claims
WHERE status = 'RESERVED';
```

These are **observations**, not automatic retry thresholds or approved SLOs. Choose alert thresholds only after staging measurements and owner approval.

## 2. Investigate an individual reservation

- Correlate the exact internal idempotency key **inside the authorized environment only** with gateway request trace and the provider's lookup/idempotency API. Avoid sending that key to generic support chat, screenshots, or monitoring labels.
- Check whether the provider guarantees authenticated receipts and lookup by the *same* idempotency key. Record documented guarantees, request/receipt timestamps and provider incident/reference identifiers in a restricted incident record.
- Distinguish **confirmed accepted**, **confirmed not sent**, and **unknown**. A missing receipt alone is NOT proof of non-delivery; timeout alone is NOT proof of failure.
- For unknown or inconsistent evidence, keep the row `RESERVED`; escalate to the provider and security owner. Do not issue another OTP automatically.

## 3. Resolution gates (not implemented)

The current reference ledger intentionally exposes only `claim` and `recordAccepted`; it has **no operator reset/retry/delete endpoint**. There is no approved automatic reconciliation worker.

| Evidence | Safe handling |
| --- | --- |
| Authenticated provider acceptance with same key and matching fingerprint | Propose reviewed, audited, conditional acceptance recording only via a separately approved reconciliation implementation; verify provider reference uniqueness and transaction semantics |
| Provider response ambiguous/unavailable | Keep `RESERVED`, preserve investigation evidence, escalate |
| Provider states not delivered, but cannot prove exclusive non-delivery | Keep `RESERVED`; a new send remains unsafe |
| Suspected leaked key, forged receipt or conflicting fingerprint | Freeze affected operations, trigger security incident process |
| Accepted claim already present | Do not change receipt; investigate discrepancies separately |

Do **not** execute manual `UPDATE`, `DELETE`, `TRUNCATE`, `INSERT ... ON CONFLICT UPDATE` or bypass integrity checks in production. Any future admin reconciliation command requires separate design review, two-person approval, audit log, scoped authorization, provider proof verification, idempotent compare-and-swap and real PostgreSQL failure/concurrency tests before activation.

## 4. Evidence and closure

Capture: incident identifier, environment and gateway version, affected-count aggregates, start/end times in UTC, trace and provider references in restricted storage, approval identities, provider guarantee, reconciliation decision, acceptance test links, and security/data-residency sign-offs.

Before closing: confirm no duplicate provider sends, no ledger integrity violations, no credentials or OTP payloads in logs, backups and KZ data placement preserved, alert thresholds reviewed, and staging replay/outage tests approved. Update `docs/MASTER_CHECKLIST.md` with **actual** CI/deployment evidence, not a readiness estimate.

## Remaining acceptance blockers

- Approved live OTP provider with authenticated receipt/idempotency and query contract.
- Kazakhstan-resident private ingress, approved egress/network provenance, real TLS/mTLS CA lifecycle and secrets management.
- Restricted operational lookup, audit and dual-approval reconciliation design and tests.
- Staging failure drills (provider timeout/partial success, database outage, process restart, overlapping requests, rotation and rollback), provider and security sign-off.

**No production deployment or permission to manipulate reservations is conveyed by this document.**
