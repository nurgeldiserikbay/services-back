# Transactional in-app notification pipeline

## Stage 1 — compose existing safe stages

`processInAppNotificationBatch(client,limit)` stages previously committed notification intents into durable PENDING delivery records, then materializes eligible IN_APP deliveries to DELIVERED. The caller supplies a single PostgreSQL transaction. `InAppNotificationPipelineService.processBatch()` encapsulates this database transaction for future trusted scheduler integration. Max batch size: 50; default 25.

## Stage 2 — channel separation and privacy

This path does **not** send SMS/email/push. External delivery rows remain PENDING for a separately approved worker. `DELIVERED` for IN_APP means available to the authorized recipient-scoped inbox, not read by the user. Global `domain_outbox_events.processed_at` remains untouched so other consumers can process the event. The pipeline projects no contacts, codes, request notes, provider credentials or bearers.

The service is intentionally **not registered as an HTTP endpoint or automatically running worker**. Production scheduling still requires leases/monitoring, alerting and deployment controls; authenticated inbox UI and user read/seen state are separate work.

## Stage 3 — database regression

PostgreSQL tests prove a mixed-channel outbox event creates one IN_APP delivered row and leaves EMAIL PENDING; a repeated pipeline call creates no duplicates and does not increment delivery attempts; person inbox isolation, global outbox preservation and invalid limits are checked.

No vendor or login capability is activated. This is an incremental step toward the complete client → seller → client notification journey.
