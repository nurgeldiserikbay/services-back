-- A terminal alert routing failure is count-only operational state.
-- Prevent retry storms after the reviewed attempt budget is exhausted.
-- Never store provider response, token, identity or message content here.
CREATE TABLE notification_alert_receiver_terminal_failures (
 ingress_id uuid PRIMARY KEY
  REFERENCES notification_alert_receiver_ingress(id) ON DELETE RESTRICT,
 reason_code text NOT NULL DEFAULT 'ATTEMPTS_EXHAUSTED'
  CHECK (reason_code='ATTEMPTS_EXHAUSTED'),
 created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE OR REPLACE FUNCTION reject_notification_alert_receiver_terminal_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'notification alert receiver terminal failure is immutable';
END;
$$;
CREATE TRIGGER notification_alert_receiver_terminal_immutable
 BEFORE UPDATE OR DELETE ON notification_alert_receiver_terminal_failures
 FOR EACH ROW EXECUTE FUNCTION reject_notification_alert_receiver_terminal_mutation();
