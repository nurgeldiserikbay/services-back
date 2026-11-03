# Notification Outbox — Stage 1

This branch adds a **durable, idempotent staging operation** but does not yet deliver messages or mark a request as accepted/seen. It is an internal service, not a public endpoint or a running scheduled worker.

`OutboxStagingService.stageBatch()` runs under `DatabasePool.transaction()`. The SQL locks outbox event rows with unqueued notification intents (`FOR UPDATE SKIP LOCKED`), inserts one PENDING `notification_deliveries` row for each intent+channel, and relies on the database uniqueness constraint to deduplicate. No user contact, request note, OTP, or bearer capability is copied. Tests run against actual PostgreSQL.

**Important invariant:** this stage intentionally does NOT set `domain_outbox_events.processed_at`. A global outbox event may have multiple consumers, and staging the notification delivery rows alone is not proof they all ran. Nor does staging mark notification intent or delivery state SENT/DELIVERED.

Before production:
- Add a separate provider delivery worker with lease/claim/retries and per-channel budgets.
- Enforce recipient resource permissions, verified guest contact and user preferences at actual send time.
- Keep delivery state consistent with receipt and in-app notification views.
- Provide dead-letter, monitoring, no duplicate external send, no PII logs and crash recovery tests.
- Run a scheduled executor only after operational protections and secret management are reviewed.
