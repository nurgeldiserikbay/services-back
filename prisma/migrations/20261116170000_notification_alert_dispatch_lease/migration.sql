-- Alert event audit stays immutable; delivery state is stored separately.
-- Does not enable any transport or background scheduler.
CREATE TABLE notification_alert_dispatches (
 event_id uuid PRIMARY KEY REFERENCES notification_alert_events(id) ON DELETE RESTRICT,
 attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
 lease_token uuid,
 lease_expires_at timestamptz(3),
 delivered_at timestamptz(3),
 CHECK ((lease_token IS NULL)=(lease_expires_at IS NULL)),
 CHECK (delivered_at IS NULL OR lease_token IS NULL)
);
CREATE INDEX notification_alert_dispatches_ready_idx
 ON notification_alert_dispatches(lease_expires_at,event_id)
 WHERE delivered_at IS NULL;
