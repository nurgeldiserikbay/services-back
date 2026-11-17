-- Optional receiver monitoring re-page suppression metadata.
-- This migration stores only scope, allowlisted metric code, threshold and the
-- time the opt-in transport reported success. No raw alert, URL, bearer token,
-- provider response, tenant record, message or user identifier is persisted.
-- No scheduler or dispatch is activated by this schema.
CREATE TABLE notification_receiver_monitor_delivery_state (
 receiver_scope text NOT NULL
  CHECK (receiver_scope ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
 code text NOT NULL CHECK (code IN (
  'RETRY_BACKLOG','EXPIRED_LEASES','TERMINAL_FAILURES','INCONSISTENT_STATE'
 )),
 last_threshold bigint NOT NULL CHECK (last_threshold >= 1),
 last_delivered_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY (receiver_scope,code)
);
