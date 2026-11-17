-- Opt-in receiver worker claim lease. No scheduler, network I/O, or automatic ACK.
ALTER TABLE notification_alert_receiver_ingress
 ADD COLUMN lease_token uuid,
 ADD COLUMN lease_expires_at timestamptz(3),
 ADD COLUMN claim_count integer NOT NULL DEFAULT 0
  CHECK (claim_count >= 0 AND claim_count <= 2147483647);

ALTER TABLE notification_alert_receiver_ingress
 ADD CONSTRAINT notification_alert_receiver_lease_pair
 CHECK ((lease_token IS NULL) = (lease_expires_at IS NULL));
CREATE INDEX notification_alert_receiver_claimable_idx
 ON notification_alert_receiver_ingress(created_at,id)
 WHERE state='PENDING';

-- Preserve immutable accepted content, and allow only bounded lease changes
-- while still pending. ACK must clear an existing lease as one transition.
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
    NEW.claim_count < OLD.claim_count OR
    NEW.claim_count > OLD.claim_count + 1 OR
    (OLD.state='ACKED') OR
    NOT (NEW.state IN ('PENDING','ACKED')) OR
    (NEW.state='ACKED' AND (
      OLD.state<>'PENDING' OR NEW.lease_token IS NOT NULL OR
      NEW.lease_expires_at IS NOT NULL OR
      NEW.claim_count<>OLD.claim_count)) OR
    (NEW.state='PENDING' AND
      ((NEW.lease_token IS DISTINCT FROM OLD.lease_token AND
         NEW.claim_count<>OLD.claim_count+1) OR
       (NEW.lease_token IS NOT DISTINCT FROM OLD.lease_token AND
         NEW.claim_count<>OLD.claim_count))) THEN
  RAISE EXCEPTION 'notification alert receiver ingress is immutable';
 END IF;
 RETURN NEW;
END;
$$;
