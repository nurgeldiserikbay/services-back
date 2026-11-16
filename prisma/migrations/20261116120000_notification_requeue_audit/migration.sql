-- Minimal append-only audit for manual external notification requeue.
-- No message content, recipient, provider errors or bearer proofs are stored.
CREATE TABLE notification_requeue_audit (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 delivery_id uuid NOT NULL REFERENCES notification_deliveries(id) ON DELETE RESTRICT,
 intent_id uuid NOT NULL REFERENCES notification_intents(id) ON DELETE RESTRICT,
 actor_staff_id uuid NOT NULL REFERENCES platform_admin_staff(id) ON DELETE RESTRICT,
 requeue_key uuid NOT NULL UNIQUE,
 occurred_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX notification_requeue_audit_delivery_idx
 ON notification_requeue_audit(delivery_id,occurred_at);

-- The record is immutable even for users with table UPDATE/DELETE grants.
CREATE OR REPLACE FUNCTION reject_notification_requeue_audit_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'notification requeue audit is append-only';
END;
$$;
CREATE TRIGGER notification_requeue_audit_immutable
 BEFORE UPDATE OR DELETE ON notification_requeue_audit
 FOR EACH ROW EXECUTE FUNCTION reject_notification_requeue_audit_mutation();
