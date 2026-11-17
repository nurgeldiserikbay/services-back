# Receiver monitoring — staging acceptance and activation gates

Status: **PREPARED / NOT ACTIVATED**. This runbook is an acceptance plan, not evidence of a staging drill or authorization to enable production alerts.

## Scope and architecture

- Source: `readExternalAlertReceiverCounts(db, receiverScope)` reads a single trusted deployment scope from PostgreSQL.
- Offline evaluation: `evaluateExternalAlertReceiverMonitor(counts, thresholds)` validates all count and threshold fields and returns frozen count-only breaches.
- Observation: `observeExternalAlertReceiver(db, receiverScope, thresholds)` validates the policy before SQL and returns an aggregate-only snapshot.
- Explicit dispatch: `dispatchExternalAlertReceiverMonitoring(db, receiverScope, thresholds, transport)` sends ONLY `{code,observed,threshold}` breach records to a caller-provided transport. No send occurs on a healthy snapshot. SQL or transport failures propagate.
- None of these primitives creates a background scheduler, binds an HTTP route, provisions a provider, or chooses thresholds.

## Pre-activation gates (all required)

1. **Data owner:** approve receiver deployment scope and verify no guest/public user can supply or override it. Record an owner, environment and code SHA; never put credentials, tokens, user identifiers, message payloads or actual alerts in evidence.
2. **SLO owner:** measure retry backlog, expired leases, terminal failures and inconsistent state during representative staging traffic, including planned load and recovery. Approve four positive integer thresholds (`retryScheduled`, `leasedExpired`, `terminal`, `inconsistent`); there are **no production defaults**. Record the source, duration, approval and rationale without including private data.
3. **Transport owner:** configure a real private, authenticated destination with a bounded deadline and limited access. Verify its identity/authentication, TLS, retry behavior, rate limiting, delivery audit and redacted logs. Mock/in-memory transport is **not** production acceptance.
4. **Scheduler owner:** define explicit cadence, maximum overlapping executions, process termination behavior, database connection handling and failed-run alerting. Run observation only using the approved operator scope. No scheduler is bundled with the module.
5. **Security reviewer:** verify DB least privilege, service-to-service credentials, secret rotation, transport destination allowlist, no public route, and that outgoing payloads contain only `code`, `observed`, `threshold`.
6. **On-call owner:** document coverage, acknowledgment and escalation, paging thresholds, deduplication/repeated-alert handling, recovery and false-positive suppression. A count-only monitoring dispatcher alone does **not** provide deduplication, notification acknowledgments or paging.

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
