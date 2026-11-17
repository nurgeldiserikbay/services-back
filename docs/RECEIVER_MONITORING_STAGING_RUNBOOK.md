# Receiver monitoring — staging acceptance and activation gates

Status: **PREPARED / NOT ACTIVATED**. This runbook is an acceptance plan, not evidence of a staging drill or authorization to enable production alerts.

## Scope and architecture

- Source: `readExternalAlertReceiverCounts(db, receiverScope)` reads a single trusted deployment scope from PostgreSQL.
- Offline evaluation: `evaluateExternalAlertReceiverMonitor(counts, thresholds)` validates all count and threshold fields and returns frozen count-only breaches.
- Observation: `observeExternalAlertReceiver(db, receiverScope, thresholds)` validates the policy before SQL and returns an aggregate-only snapshot.
- Explicit dispatch: `dispatchExternalAlertReceiverMonitoring(db, receiverScope, thresholds, transport)` sends ONLY `{code,observed,threshold}` breach records to a caller-provided transport. No send occurs on a healthy snapshot. SQL or transport failures propagate.
- None of these primitives creates a background scheduler, binds an HTTP route, provisions a provider, or chooses thresholds.

## Optional HTTPS adapter — not activated

The repository provides `createReceiverMonitorHttpsTransport(config, request?)` as an **opt-in** adapter for operator-owned monitoring dispatch. There is no default endpoint, scheduler, token, threshold policy or active binding. The operator must supply an explicit exact HTTPS URL, matching approved hostname, a secret bearer token from the secret manager and a bounded request timeout (1–10 seconds). It transmits only the validated `breaches` array containing `code`, `observed` and `threshold`; errors are redacted and propagated. Non-2xx results and redirects are failures. The unit tests inject an HTTP substitute and **do not prove provider connectivity**.

**Security limit:** hostname string validation alone does not establish DNS/IP routing safety. Before any real destination is approved, restrict outbound network access to the approved provider, audit DNS and proxy resolution, enforce TLS/credential scope and egress firewalls, verify provider authentication and test request failures. Treat operator-approved URLs as privileged configuration, never as user input. Do not use this adapter against arbitrary customer-supplied or public URLs.

## Optional one-shot staging HTTPS dispatch (no scheduler)

`pnpm monitor:receiver:send:staging` is an **explicit one-shot send**, not the read-only preview. It may transmit a count-only alert to a real configured recipient, so it must only run in a controlled staging environment after a transport owner has approved the exact HTTPS host and egress network policy. Do not invoke it with production credentials, a production database or a production destination. This command does not make the system production-ready.

The operator must supply environment variables securely: `DATABASE_URL` (staging-only, least-privilege read access), `RECEIVER_MONITOR_ENVIRONMENT=staging`, `RECEIVER_MONITOR_SCOPE`, all four `RECEIVER_MONITOR_*` threshold strings used in preview, `RECEIVER_MONITOR_PREVIEW_ACK=READ_ONLY_STAGING`, **separate** `RECEIVER_MONITOR_SEND_ACK=SEND_ONCE_STAGING`, `RECEIVER_MONITOR_ENDPOINT`, `RECEIVER_MONITOR_APPROVED_HOSTNAME`, `RECEIVER_MONITOR_BEARER_TOKEN` and `RECEIVER_MONITOR_TIMEOUT_MS` (1000–10000). The exact endpoint must be HTTPS and its hostname must match the approved value; credentials belong in a secret manager, not command arguments or logs.

The command holds a PostgreSQL session advisory lock for the configured receiver scope during its single observation and HTTP request. A second overlapping manual invocation of the same scope fails closed; other scopes remain independent. The lock is released on success or failure, and process/connection termination also releases it. **This only prevents overlap, not later repeated pages or durable deduplication.** PostgreSQL client session identity must be preserved across the send.

The parser validates everything before connecting to PostgreSQL. An empty breach list does not send any HTTP request. A nonempty breach list generates one bounded HTTPS POST with only `code`, `observed` and `threshold`. Output on success is only `{"mode":"one-shot-staging-send","breachCount":N}` and on any failure only `receiver_monitor_staging_send_failed` on stderr with nonzero exit. **Success indicates a 2xx response, not durable delivery, paging, acknowledgment, deduplication or on-call acceptance.** DNS/IP egress controls and live provider acceptance are external preconditions.

## Durable cooldown watermark foundation (NOT activated)

The migration `notification_receiver_monitor_delivery_state` and helpers `selectReceiverMonitoringDueBreaches` / `recordReceiverMonitoringDelivered` provide a **prepared, opt-in** PostgreSQL suppression watermark scoped to receiver scope and allowlisted breach code. An explicit 60–86400-second suppression window is required; changing the threshold permits a fresh alert. The table stores only receiver scope, aggregate code, numeric threshold and the last *successfully reported* delivery time.

**Optional staging CLI integration:** `RECEIVER_MONITOR_COOLDOWN_SECONDS` (an explicit decimal integer from 60 to 86400) activates the cooldown for that one invocation of `pnpm monitor:receiver:send:staging`. If omitted, no suppression is performed, preserving existing send behavior. The CLI holds the same-scope advisory lock across observation, selection, HTTPS send and watermark update, and calls `recordReceiverMonitoringDelivered` only after the transport reports a successful HTTP send. Failed or uncertain sends must remain eligible. **Before enabling this option, the staging/on-call owner must approve the cooldown and repeat-paging policy.** Neither a provider 2xx nor this watermark proves durable receipt or on-call acknowledgment. The operational owner must approve the cooldown, re-page and incident escalation policy before activation.

## Pre-activation gates (all required)

1. **Data owner:** approve receiver deployment scope and verify no guest/public user can supply or override it. Record an owner, environment and code SHA; never put credentials, tokens, user identifiers, message payloads or actual alerts in evidence.
2. **SLO owner:** measure retry backlog, expired leases, terminal failures and inconsistent state during representative staging traffic, including planned load and recovery. Approve four positive integer thresholds (`retryScheduled`, `leasedExpired`, `terminal`, `inconsistent`); there are **no production defaults**. Record the source, duration, approval and rationale without including private data.
3. **Transport owner:** configure a real private, authenticated destination with a bounded deadline and limited access. Verify its identity/authentication, TLS, retry behavior, rate limiting, delivery audit and redacted logs. Mock/in-memory transport is **not** production acceptance.
4. **Scheduler owner:** define explicit cadence, maximum overlapping executions, process termination behavior, database connection handling and failed-run alerting. Run observation only using the approved operator scope. No scheduler is bundled with the module.
5. **Security reviewer:** verify DB least privilege, service-to-service credentials, secret rotation, transport destination allowlist, no public route, and that outgoing payloads contain only `code`, `observed`, `threshold`.
6. **On-call owner:** document coverage, acknowledgment and escalation, paging thresholds, deduplication/repeated-alert handling, recovery and false-positive suppression. A count-only monitoring dispatcher alone does **not** provide deduplication, notification acknowledgments or paging.

## One-shot operator dry-run CLI (does not dispatch alerts)

Use only against an approved private staging PostgreSQL endpoint with a read-only account and an operator-controlled deployment scope. Export the sensitive `DATABASE_URL` through the deployment secret manager; **do not paste credentials into shell history, log files or PRs**.

Set `RECEIVER_MONITOR_PREVIEW_ACK=READ_ONLY_STAGING` as an explicit one-shot operator acknowledgment; the preview CLI fails closed without this exact value. This acknowledgment is **not** production authorization or a substitute for authenticated deployment scope controls.

Set `RECEIVER_MONITOR_SCOPE` and all four mandatory positive integer string values: `RECEIVER_MONITOR_RETRY_SCHEDULED`, `RECEIVER_MONITOR_LEASED_EXPIRED`, `RECEIVER_MONITOR_TERMINAL`, `RECEIVER_MONITOR_INCONSISTENT`. Use only thresholds approved for the staging measurement window; there are no defaults.

Execute `pnpm monitor:receiver:preview` from the backend directory with these environment variables supplied securely. The one-shot command opens a bounded PostgreSQL connection, runs a read-only transaction, and prints only `{"mode":"dry-run","breaches":[{"code":"...","observed":1,"threshold":1}]}` (or an empty breaches array). On any failure it exits nonzero with the constant error `receiver_monitor_preview_failed`, avoiding SQL errors and credentials in logs.

**No email, webhook, paging provider, scheduled task, or external network delivery is performed other than the configured PostgreSQL connection.** A successful dry-run cannot be counted as delivery, staging drill, or production activation approval.

## Staging acceptance matrix

| Case | Setup (staging only) | Required evidence |
| --- | --- | --- |
| Healthy | No breaches in selected scope | No transport invocation; counts correctly scoped |
| Retry backlog | Persist a bounded retry deadline under a valid lease | `RETRY_BACKLOG` at the approved threshold |
| Lease expiry | Expire a claimed lease | `EXPIRED_LEASES`; stale ACK cannot clear current ownership |
| Reclaim and ACK | Reclaim with a new token, then ACK | Expired-lease breach clears; acknowledged count rises |
| Terminal | Exhaust allowed attempts and persist terminal failure | `TERMINAL_FAILURES`; non-claimable terminal record |
| Inconsistent state | Inject a controlled invalid row only in isolated test fixtures | `INCONSISTENT_STATE`; never suppress or silently mark healthy |
| Isolation | Repeat checks in a separate receiver scope | No cross-scope counts, alerts or identifiers |
| Bad policy | Non-integer, zero, missing or accessor-backed thresholds | Reject before SQL and transport |
| Database outage | Deny the observation query | Fail visibly; do not report green or send success |
| Transport outage | Reject a valid alert send | Propagate failure; on-call path sees failed run; never mark delivered |
| Data privacy | Inspect outgoing payload, traces and logs | No scope, tenant, idempotency key, token, raw JSONB, PII or provider error body |
| Concurrency | Run parallel workers with bounded leases | No false ACK, no duplicate claimant, explicit duplicate/paging policy |

## Test and review evidence to attach

- `test/external-delivery-alert-receiver-observation-db.test.ts` — scoped snapshot and fail-closed policy.
- `test/external-delivery-alert-receiver-observation-breaches-db.test.ts` — retry and terminal warning thresholds.
- `test/external-delivery-alert-receiver-observation-lease-db.test.ts` — expired lease, token rotation, stale ACK and recovery.
- `test/external-delivery-alert-receiver-monitor-dispatch.test.ts` — allowlisted payload and transport rejection.
- `test/external-delivery-alert-receiver-monitor-dispatch-db.test.ts` — PostgreSQL-to-in-memory-transport staging simulation.
- Record exact commit SHA, GitHub Actions run URL and PASS result for the tested revision; distinguish CI simulations from observed staging drills. Run `pnpm typecheck` / `pnpm test` only if these scripts are present in package.json, otherwise use the checked-in CI workflow's actual commands.

## Rollout, rollback and sign-off

- Start in a separate staging scope with explicitly supplied thresholds and mock transport. Enable a real private staging transport only after security and on-call review.
- Verify failure visibility, rate limits, paging deduplication and safe recovery before scheduling any production job. Prefer a manually invoked opt-in dry run before recurring execution.
- Rollback must stop the scheduler/transport without deleting append-only receiver evidence, mutating ACKs or exposing secrets. Preserve a private audit trail of operator actions.
- Sign-off record must include: environment, date/time in an IANA timezone, source commit and CI URLs, approved threshold values, measurement window, reviewer identities/roles, staging drill report, on-call rota confirmation, destination owner, rollback rehearsal and any remaining risks.
- **Keep `Delivery monitoring` unchecked in `MASTER_CHECKLIST.md`** until all real transport, scheduler, SLO, security, on-call and staging acceptance gates above are evidenced. Passing the repository tests is necessary but insufficient.
