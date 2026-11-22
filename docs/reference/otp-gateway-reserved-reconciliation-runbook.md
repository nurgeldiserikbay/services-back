# OTP gateway unresolved reservations — operator runbook (draft)

**Status:** documentation only, NOT an approved procedure or a production deployment.
**System:** separately hosted OTP gateway PostgreSQL ledger (not the Services application database).
**Owner/sign-off required:** security lead, KZ infrastructure/data owner, OTP provider owner, incident commander.
**Related:** `docs/reference/otp-gateway-idempotency-ledger.sql`, `src/platform/ingress/otp-gateway-postgres-ledger.reference.ts`.

## Safety invariant

A `RESERVED` row means the gateway durably claimed the idempotency key, but cannot prove whether the external OTP provider delivered the message. Timeouts, process death, invalid provider acknowledgements and failed acknowledgement writes are **ambiguous outcomes**.

**Never** automatically delete, expire, reclaim, re-key or reset a `RESERVED` row to trigger another send. Never change `fingerprint` or `idempotency_key`; never use a new key to replay an unresolved OTP. A retry of the same key must remain `in_flight` / HTTP 409. An altered signed payload under that key must remain `conflict` / HTTP 409.

No raw OTP, destination, access token, HMAC secret, client certificate private key or full request payload belongs in this ledger, operator report or logs.

## 1. Detect and contain

1. Confirm the alert belongs to the **dedicated** OTP gateway database and identify the deployment, environment, owner and timestamp without copying credentials.
2. Validate gateway clock, database health, audit trail, network status and the provider's current outage notices.
3. Pause affected gateway outbound delivery if suspected duplicate sends, unauthorized access or provider contract failure are observed. Do not stop unrelated notification channels without an incident decision.
4. Verify RBAC: read-only investigator access is distinct from emergency operations approval. Use approved secure access, not a public SQL endpoint.

For a read-only count, from a controlled operator session with **SELECT-only** access:

```sql
SELECT count(*)::bigint AS unresolved_count,
       min(claimed_at) AS oldest_claim_at
FROM otp_gateway_delivery_claims
WHERE status = 'RESERVED';
```

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
