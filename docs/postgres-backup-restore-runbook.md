# PostgreSQL backup and restore runbook

This runbook is for the Services backend PostgreSQL database. It is an operator procedure, not evidence that a production restore has already passed.

## Preconditions

- Confirm the target environment, database owner, PostgreSQL major version and maintenance window.
- Use a dedicated backup/restore identity with least privilege. Do not place passwords in command-line arguments, shell history or CI logs.
- Use a private backup destination, encrypted storage, retention policy and restricted filesystem permissions.
- Keep production and recovery credentials separate. Restore only into a **disposable, isolated database**; never test restore against production.
- Prefer PostgreSQL client utilities matching the server major version. Check `pg_dump --version` and `pg_restore --version`.

## 1. Create a consistent logical backup

Run from a secured operator environment with `DATABASE_URL` supplied by a secret manager. This example includes all application schemas in the selected database.

```bash
set -euo pipefail
umask 077
: "${DATABASE_URL:?DATABASE_URL must be set}"
backup="services-$(date -u +%Y%m%dT%H%M%SZ).dump"
pg_dump --dbname="$DATABASE_URL" --format=custom --no-owner --no-acl --file="$backup"
test -s "$backup"
pg_restore --list "$backup" > "$backup.toc"
sha256sum "$backup" > "$backup.sha256"
```

A checksum detects corruption during transfer; it does not establish authenticity unless the checksum is stored in a separately trusted location. Encrypt the backup before uploading it to offsite storage.

## 2. Restore to an isolated database

Provision an empty **non-production** database and supply its connection string as `RESTORE_DATABASE_URL`. Confirm its identity before running any command. Never reuse the production `DATABASE_URL` variable for restore.

```bash
set -euo pipefail
: "${RESTORE_DATABASE_URL:?RESTORE_DATABASE_URL must be set}"
: "${BACKUP_FILE:?BACKUP_FILE must be set}"
test -s "$BACKUP_FILE"
pg_restore --dbname="$RESTORE_DATABASE_URL" --no-owner --no-acl \
  --single-transaction --exit-on-error "$BACKUP_FILE"
psql "$RESTORE_DATABASE_URL" -v ON_ERROR_STOP=1 -Atc \
  "SELECT current_database(), current_schema(), to_regclass('public.service_requests') IS NOT NULL;"
```

**Safety gate:** independently verify the restore connection points to the disposable recovery instance before executing `pg_restore`. Do not assume that a different database name implies a different server.

## 3. Verify recovery

- Verify required tables, indexes, foreign keys and Prisma migration history.
- Run the backend database smoke tests and read-only integrity checks against the restored database.
- Compare row counts and critical aggregates against a separately captured, timestamped backup manifest; allow for the backup snapshot time.
- Verify that the recovered application can start in an isolated environment with external notifications, payments and other side effects disabled.
- Record backup timestamp, recovery start/end, data consistency, failures, recovery-point objective (RPO) and recovery-time objective (RTO).
- Destroy the recovery database and revoke temporary credentials when verification is complete.

## 4. Production safeguards

- Logical backups do **not** provide point-in-time recovery (PITR). Configure and test WAL archiving plus physical base backups separately if PITR is required.
- Schedule periodic automated restore drills, not merely backup creation.
- Monitor backup freshness, size anomalies, checksum validation and offsite replication.
- Never put customer PII, connection strings or raw database dumps in GitHub Actions artifacts or public logs.
- Do not mark the disaster-recovery requirement complete until a timed restore drill and recovery report have been reviewed.
