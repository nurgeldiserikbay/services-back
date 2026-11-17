-- Durable receiver retry deadlines. No scheduler is enabled by this migration.
-- Keep accepted immutable ingress untouched; a failed route remains PENDING.
CREATE TABLE notification_alert_receiver_retry_schedule (
 ingress_id uuid PRIMARY KEY
  REFERENCES notification_alert_receiver_ingress(id) ON DELETE RESTRICT,
 next_attempt_at timestamptz(3) NOT NULL,
 updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX notification_alert_receiver_retry_due_idx
 ON notification_alert_receiver_retry_schedule(next_attempt_at,ingress_id);
