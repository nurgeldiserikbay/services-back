# In-app notification materialization

The platform's user-facing notification inbox can reuse already committed `notification_intents` + `notification_deliveries` rows without an external provider. A separate internal, transactional batch materializes PENDING IN_APP delivery rows as DELIVERED. This is **durable in-app availability**, not recipient read/acknowledgment and not email/SMS/push success.

A recipient-scoped read model only returns topic, subject ID and timestamp for a **server-authorized** canonical person ID. It is intentionally not mounted on a public route and does not expose raw contact, private request notes, bearer capabilities, or personal address. Company recipients require separate server-side membership permissions and are not covered by this read model.

Required before public use: authenticated sessions and per-resource ACL, notification copy localization and safe subject resolution, private read/seen state, guest channel delivery provider, worker scheduling, monitoring, retry/recovery and concurrency load tests. Never report a queued notification as delivered to a phone.

Unit/integration tests exercise materialization, idempotent replay, state transitions and recipient isolation on real PostgreSQL.
