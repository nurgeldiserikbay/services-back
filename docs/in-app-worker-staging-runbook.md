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

## Disable / incident response

```sh
sudo systemctl disable --now services-in-app-worker.timer
sudo systemctl stop services-in-app-worker.service
sudo systemctl show services-in-app-worker.timer -p ActiveState -p UnitFileState
```

Disable scheduling before secret rotation or incident investigation. Do not delete or replay persistent notification deliveries after an uncertain commit; inspect the aggregate delivery state and use the existing idempotent pipeline on the next approved run. For any residency or access-control anomaly, revoke worker credentials and block the private database route. **Do not enable real account OTP, SMS/email delivery or production scheduling under this runbook.**
