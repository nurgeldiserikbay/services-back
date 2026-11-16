-- Durable, count-only notification alert episodes; not a transport or scheduler.
-- Intentionally no recipient, provider response, payload, token or request ID.
CREATE TABLE notification_alert_states (
 code text PRIMARY KEY CHECK (code IN (
  'QUEUE_INCONSISTENT','EXPIRED_LEASES','TERMINAL_FAILURES','DUE_BACKLOG'
 )),
 active boolean NOT NULL DEFAULT false,
 generation bigint NOT NULL DEFAULT 0 CHECK (generation >= 0),
 updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE notification_alert_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 code text NOT NULL REFERENCES notification_alert_states(code) ON DELETE RESTRICT,
 generation bigint NOT NULL CHECK (generation > 0),
 observed bigint NOT NULL CHECK (observed >= 0),
 threshold bigint NOT NULL CHECK (threshold >= 1),
 severity text NOT NULL CHECK (severity IN ('critical','warning')),
 created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE (code,generation)
);
CREATE INDEX notification_alert_events_created_idx
 ON notification_alert_events(created_at,id);

-- Episodes form an immutable audit/outbox foundation. Publication ACK,
-- retries and transport are a separate future implementation.
CREATE OR REPLACE FUNCTION reject_notification_alert_event_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'notification alert event is append-only';
END;
$$;
CREATE TRIGGER notification_alert_events_immutable
 BEFORE UPDATE OR DELETE ON notification_alert_events
 FOR EACH ROW EXECUTE FUNCTION reject_notification_alert_event_mutation();
