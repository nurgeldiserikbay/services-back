# IN_APP worker — Kazakhstan staging scheduler runbook

**Status: TEMPLATE ONLY / NOT DEPLOYED / NOT ENABLED.** This repository does not run scheduled jobs on GitHub-hosted infrastructure. The two unit templates under `ops/systemd/` must be installed and reviewed on a separately approved **Kazakhstan-resident** staging host, with the PostgreSQL instance and all relevant backups/network transit also approved for KZ data residency. This is not a public worker API.

## Before enabling

An operator must independently verify and record: (1) exact reviewed backend main commit and passing backend CI; (2) Kazakhstan host/DB/backup regions, outbound network paths and DNS destination; (3) approved `services-worker` Unix user; (4) least-privileged PostgreSQL credentials permitting ONLY required notification/outbox reads and notification delivery updates (check the SQL used by `outbox-staging.ts` and `in-app-materialization.ts`); (5) read-only checkout under `/srv/services-back`, verified Node 22 and installed locked dependencies; (6) approved secret rotation, alert contacts, monitoring window and incident rollback. The entire checklist must be completed separately before any production activation.

The operator provisions **/etc/services/in-app-worker.env**, owned by root with `chmod 0600`; never commit this file. Example variable **names only**:

```sh
SERVICES_ENABLE_IN_APP_NOTIFICATION_WORKER=enabled
SERVICES_NOTIFICATION_EXTERNAL_DELIVERY=disabled
DATABASE_URL=<operator-supplied-KZ-private-PostgreSQL-connection>
```

Do not copy literal placeholder text into an environment file. Never echo, trace or upload the actual URI, encrypted contacts, recipient identifiers or bearer tokens. A production environment file must be explicitly reviewed, rather than copied from staging.

## Staging activation (operator only)

Copy `ops/systemd/services-in-app-worker.service` and `ops/systemd/services-in-app-worker.timer` into `/etc/systemd/system/` on the approved Kazakhstan-resident host, after reviewing paths, account and sandbox limitations. Run:

```sh
sudo systemctl daemon-reload
sudo systemctl start services-in-app-worker.service
sudo systemctl show services-in-app-worker.service -p Result -p ExecMainStatus
sudo systemctl list-timers services-in-app-worker.timer --all
# Only after manual one-shot success, region and monitoring signoff:
sudo systemctl enable --now services-in-app-worker.timer
```

The timer is NOT enabled by GitHub CI, nor by its presence in the repository. It runs one bounded batch every five minutes. A skipped/failed batch never retries an uncertain COMMIT inside the same invocation. Future invocations reconcile unique delivery rows; concurrency uses PostgreSQL `SKIP LOCKED`. `Persistent=false` prevents an outage from triggering catch-up bursts.

## Evidence and safe observability

Record the version, server region attestation, migration revision, isolated staging DB identity, timestamp, reviewer and `systemctl show` status in the deployment approval system. Redact credentials, contacts, session tokens and request/recipient IDs. Monitor aggregate pending IN_APP intent count, oldest pending age, `DELIVERED` count, worker exit code, last successful invocation and scheduler lag. On repeated failures alert an operator; do not dump SQL parameters or row payloads. The worker logs aggregate batch counts only.

A safe aggregate SQL example **for the approved on-host operator** (no recipient data):

```sql
SELECT state, count(*)::bigint
FROM notification_intents
WHERE channel = 'IN_APP'
GROUP BY state ORDER BY state;
```

A successful batch must not mark `EMAIL`, `SMS` or `PUSH` as delivered. Confirm a recipient-specific IN_APP entry is visible only with a valid, unrevoked account session. CI tests do not substitute for this staging verification. Staging acceptance is **NOT VERIFIED** until the operator records evidence.

## Read-only staging queue health check (operator only)

On the approved KZ-resident staging host, run a **separate** read-only command with a restricted database user after installing the reviewed backend revision. The monitor is disabled by default and never runs in GitHub Actions or at API startup:

```sh
SERVICES_ENABLE_IN_APP_MONITOR=enabled npm run monitor:in-app:once
```

The operator supplies `DATABASE_URL` through the private host secret mechanism; do not print or paste it in a command or CI environment. The monitor now performs a **runtime PostgreSQL privilege preflight in the same read-only transaction** before reading aggregates: its effective role must have SELECT on both monitored tables but no INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER on either, no CREATE on the `public` schema and no CREATE on the current database. A failing privilege check returns sanitized exit status `1`; do not make the role more powerful to bypass it. This check does **not** establish KZ residency, TLS routing, secret rotation or other cluster-wide permissions. The monitor also rejects effective SELECT privileges on `users`, `sessions`, `guest_contacts`, and `platform_admin_totp_factors`; do not reuse the account/identity service role. Operators must independently review inherited roles and all other grants. For this monitor, PostgreSQL credentials should have **SELECT only** on `notification_intents` and `domain_outbox_events`, no write privileges. This command starts `BEGIN READ ONLY` and returns aggregate pending/delivered counts and the oldest pending age, calculated from the immutable domain outbox event creation timestamp (notification intents do not have a creation timestamp).

Thresholds are initial **staging defaults pending operator approval**: pending count above 500, or oldest pending item above 900 seconds (15 minutes). Exit status `0` means the counts are inside those thresholds; `2` means at least one threshold was breached; `1` means a query, database or permission failure. The host scheduler/monitoring platform must alert operators on either `1` or `2`; do not mistake `0` for a production rollout or external provider delivery proof. Record the observed aggregates, command exit status, region/host approval, and alert acknowledgement without row IDs. Do not attach the database URI or full journals to a ticket.

The monitor command is **not automatically scheduled** by the worker timer. Any separate monitor schedule or alert receiver needs explicit on-host operator approval. A growing queue, no successful worker invocations, or a monitor failure is grounds to keep staging acceptance open and investigate before production rollout.

## Staging acceptance evidence record (operator-owned, sanitized)

Use one record per deployment candidate in the approved KZ-hosted change-management system. **Do not commit completed records** or attach environment files, complete journal output, SQL row data, recipient/request identifiers, credentials or tokens.

| Evidence field | Required observation (no sensitive values) |
| --- | --- |
| Backend revision and CI | Reviewed commit SHA and successful workflow URL for the exact revision |
| Regional approval | KZ host, PostgreSQL, backups, transit and DNS residency attestations with approver/date |
| Deployment identity | Environment name, migration revision, date/time (IANA timezone), reviewer |
| Isolation and credentials | Confirmation of dedicated service account and least-privilege worker/monitor roles; no credential values |
| Worker manual run | One-shot exit status, aggregate processed/delivered counts, and no non-IN_APP delivery |
| Read-only monitor | Exit code, pending count, delivered count, oldest pending seconds; monitor account has SELECT only |
| Scheduler/alerting | Timer state, most recent invocation, next scheduled invocation, configured alert receiver and acknowledged test alert |
| Application authorization | Signed-in recipient sees own delivered IN_APP entry; revoked/foreign account cannot |
| Rollback readiness | Timer disable/stop verified and owner/on-call identified |

**Decision rule:** retain staging acceptance as OPEN until every required observation is recorded and independently approved. Threshold-compliant aggregates alone do not verify scheduled worker delivery, account authorization, OTP provider login, external channels, or residency. If the monitor exits `1` or `2`, the worker fails repeatedly, alerts are not received, or residency cannot be attested, disable the timer and record the incident before reconsidering activation.

## Separate read-only monitor scheduler (operator-only template)

The templates `ops/systemd/services-in-app-monitor.service` and
`ops/systemd/services-in-app-monitor.timer` are **not installed or enabled**.
They must be reviewed and installed exclusively on an independently approved
Kazakhstan-resident staging host. They do not enable the notification worker.

Provision a dedicated `services-monitor` account and private root-owned
`/etc/services/in-app-monitor.env` with mode `0600`. Supply only
`SERVICES_ENABLE_IN_APP_MONITOR=enabled` and a private KZ PostgreSQL
connection from the approved secret mechanism. The monitor database role must
have SELECT only on `notification_intents` and `domain_outbox_events`;
never reuse the delivery worker's write-capable role. Do not commit credentials.

After reviewing paths, Node installation, regions, network routes, alerting
and access policies, an operator may install the two monitor units on-host and
perform the manual service check before enabling the timer:

```sh
sudo systemctl daemon-reload
sudo systemctl start services-in-app-monitor.service
sudo systemctl show services-in-app-monitor.service -p Result -p ExecMainStatus
# Only after the monitor alert receiver has been independently configured,
# tested for exit status 1 AND 2, and approved by the on-call reviewer:
sudo systemctl enable --now services-in-app-monitor.timer
sudo systemctl list-timers services-in-app-monitor.timer --all
```

The monitor alert receiver must notify the designated operator on exit code
`1` (unavailable) or `2` (threshold exceeded). Do **not** use systemd
`SuccessExitStatus=2`, since it would hide the threshold breach as success.
A timer alone does not configure alert delivery. Explicitly test and record
the recipient's alert acknowledgement before acceptance.

To disable monitoring without touching the worker timer:

```sh
sudo systemctl disable --now services-in-app-monitor.timer
sudo systemctl stop services-in-app-monitor.service
sudo systemctl show services-in-app-monitor.timer -p ActiveState -p UnitFileState
```

Record only aggregate metrics, exit statuses, and sanitized deployment evidence.
Any unsatisfied region, permission, alerting, or login evidence keeps staging
acceptance **OPEN**; no automatic deployment is performed by this change.

## Disable / incident response

```sh
sudo systemctl disable --now services-in-app-worker.timer
sudo systemctl stop services-in-app-worker.service
sudo systemctl show services-in-app-worker.timer -p ActiveState -p UnitFileState
```

Disable scheduling before secret rotation or incident investigation. Do not delete or replay persistent notification deliveries after an uncertain commit; inspect the aggregate delivery state and use the existing idempotent pipeline on the next approved run. For any residency or access-control anomaly, revoke worker credentials and block the private database route. **Do not enable real account OTP, SMS/email delivery or production scheduling under this runbook.**
