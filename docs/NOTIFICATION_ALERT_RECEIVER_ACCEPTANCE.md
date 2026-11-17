# External notification alert receiver — production acceptance contract

**Status:** Required acceptance contract; implementation and staging sign-off are **not verified**. Applies to the opt-in HTTPS alert webhook from `src/modules/notifications/external-delivery-alert-webhook.ts`. This document does not configure, deploy, authorize, or operate a receiver.

## Responsibilities

- **Services backend:** evaluates aggregate queue counts, sends an approved HTTPS POST only when invoked by a trusted host with an approved threshold policy and URL/token, and optionally includes a deterministic deployment-scoped `Idempotency-Key` header. HTTP/network failures do **not** constitute delivery success.
- **Receiver operator:** owns an authenticated HTTPS endpoint, durable atomic deduplication, alert routing and acknowledgements, audit/retention, on-call delivery and staging evidence.
- **Infrastructure owner:** owns deployment-scoped secrets, outbound DNS/egress pinning and private-address blocking, TLS verification and key rotation. Exact hostname validation in code alone does not prevent DNS rebinding or SSRF at the network layer.

## HTTP and payload contract

- HTTPS POST to a deployment-owner-approved FQDN, standard port 443, fixed path. Do not accept redirects; do not transmit tokens via query strings or URLs.
- `Authorization: Bearer <secret>` is a secret header and must be redacted from all logs, traces, metrics and error reports.
- `Content-Type: application/json`. Body: `{"alerts":[{"code":"DUE_BACKLOG","severity":"warning","observed":2,"threshold":2}]}`. At most four entries, only the allowlisted `code`, `severity`, `observed` and `threshold` fields. Never add person IDs, emails, phones, tokens, raw provider responses or request payloads.
- When configured, `Idempotency-Key: services-alert-v2-<64 lowercase hex characters>`; the key is deterministic for a canonical set of alerts, explicit `idempotencyScope` and the configured time bucket (60 seconds to one hour). **It is not an HTTP request ID or global episode identity.** A changed count or bucket can produce a different key, even while the same alert episode is active.
- Do not treat missing `Idempotency-Key` as deduplicated; it is optional in the sender and must be required explicitly in production receiver configuration if desired.

## Receiver-side durable deduplication

1. Authenticate the sender before accepting or persisting the request. Enforce a strict JSON body size limit and schema validation; reject unknown fields or duplicate alert codes.
2. Atomically write a record unique on **(receiver tenant/deployment scope, Idempotency-Key)** and a canonical body digest, in the same transaction as a durable alert-ingress/outbox record. Deduplication must work across receiver replicas and restarts; in-memory maps are insufficient.
3. New key and valid body: durably accept and return a documented 2xx only after the write commits. Publish to on-call routing from the durable ingress queue and retry until downstream acknowledged.
4. Existing key and identical digest: return the same successful acceptance outcome without creating another routed alert.
5. Existing key with conflicting canonical digest: reject with a non-2xx conflict and raise an operator-visible integration/security event. Do not overwrite an accepted record.
6. Ensure deduplication retention spans the *maximum possible sender retry duration plus clock skew*. The sender's bucket length alone does not define retention. Configure expiration only after a measured retry policy and approval.
7. Document the difference between durable receiver acceptance and human/on-call acknowledgement. A 2xx reply does not prove that a person received or acknowledged an alert.

## Staging evidence required before enabling production

| Scenario | Required evidence |
| --- | --- |
| First valid alert | Authorized 2xx only after durable receiver transaction; one ingress/outbox event |
| Exact replay / concurrent replicas | One routed event and consistent 2xx response for all identical keys |
| Key/body conflict | Non-2xx rejection; no duplicate routing; audit event without sensitive content |
| Receiver restart and database failover | Deduplication remains stable after restart/failover |
| Receiver network timeout / 500 | No false success; bounded retry through explicitly approved worker/transport mechanism |
| Missing/invalid token; unexpected body fields | Reject with no durable ingress record; credentials never logged |
| Staging vs production scope | Identical signals use distinct keys and cannot overwrite each other's records |
| DNS rebinding/private IP/redirect | Network-level egress policy blocks disallowed destinations even if DNS changes |
| Threshold and recovery drill | Approved baseline, alert firing, recover/re-arm, escalation and acknowledgement demonstrated |
| Data residency and access review | Security owner signs off KZ data-residency controls, retention and audit access |

## Release gate

Record the receiver URL *identifier* (not a secret URL), deployment scope, on-call owner, SLO/threshold approval, retention policy, key-rotation plan, egress policy and links to reproducible staging evidence under `docs/MASTER_CHECKLIST.md`. **Do not mark Delivery monitoring complete** solely on sender unit tests, a successful CI run or this contract. Avoid enabling provider network calls in CI or at application startup by default.
