-- Opt-in durable ingress for a separately authenticated notification alert receiver.
-- No public HTTP listener or scheduler is activated by this migration.
-- A row is both the deduplication record and durable routing outbox.
CREATE TABLE notification_alert_receiver_ingress (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 receiver_scope text NOT NULL
  CHECK (receiver_scope ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
 idempotency_key text NOT NULL
  CHECK (idempotency_key ~ '^services-alert-v2-[a-f0-9]{64}$'),
 body_digest text NOT NULL
  CHECK (body_digest ~ '^[a-f0-9]{64}$'),
 alerts jsonb NOT NULL
  CHECK (jsonb_typeof(alerts) = 'array'
   AND jsonb_array_length(alerts) BETWEEN 1 AND 4),
 state text NOT NULL DEFAULT 'PENDING'
  CHECK (state IN ('PENDING','ACKED')),
 created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(receiver_scope,idempotency_key)
);
CREATE INDEX notification_alert_receiver_ingress_pending_idx
 ON notification_alert_receiver_ingress(created_at,id)
 WHERE state='PENDING';

-- Accepted alert payloads and deduplication records must never be rewritten.
-- Only the routing ACK state can advance. Never erase accepted evidence.
CREATE OR REPLACE FUNCTION protect_notification_alert_receiver_ingress()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR
    NEW.id IS DISTINCT FROM OLD.id OR
    NEW.receiver_scope IS DISTINCT FROM OLD.receiver_scope OR
    NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key OR
    NEW.body_digest IS DISTINCT FROM OLD.body_digest OR
    NEW.alerts IS DISTINCT FROM OLD.alerts OR
    NEW.created_at IS DISTINCT FROM OLD.created_at OR
    NOT (OLD.state='PENDING' AND NEW.state='ACKED') THEN
  RAISE EXCEPTION 'notification alert receiver ingress is immutable';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER notification_alert_receiver_ingress_guard
 BEFORE UPDATE OR DELETE ON notification_alert_receiver_ingress
 FOR EACH ROW EXECUTE FUNCTION protect_notification_alert_receiver_ingress();
