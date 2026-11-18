-- Transactional, minimal append-only appeal action audit.
-- Captures allocation and immutable outcome at the database boundary, including
-- direct SQL writes. No reason, evidence, token, email or contact field is stored.
CREATE TABLE professional_appeal_audit_events (
 appeal_id UUID NOT NULL REFERENCES professional_moderation_appeals(id) ON DELETE RESTRICT,
 event_kind VARCHAR(32) NOT NULL CHECK (event_kind IN ('REVIEWER_ASSIGNED','APPEAL_DECIDED')),
 actor_staff_id UUID NOT NULL REFERENCES platform_admin_staff(id) ON DELETE RESTRICT,
 reviewer_staff_id UUID NOT NULL REFERENCES platform_admin_staff(id) ON DELETE RESTRICT,
 outcome VARCHAR(24),
 occurred_at TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY (appeal_id,event_kind),
 CONSTRAINT professional_appeal_audit_shape CHECK (
  (event_kind='REVIEWER_ASSIGNED' AND outcome IS NULL) OR
  (event_kind='APPEAL_DECIDED' AND outcome IS NOT NULL AND outcome IN ('UPHOLD_REJECTION','OVERTURN_REJECTION'))
 )
);
CREATE INDEX professional_appeal_audit_actor_occurred_idx
 ON professional_appeal_audit_events(actor_staff_id,occurred_at DESC);

CREATE FUNCTION audit_professional_appeal_assignment()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO professional_appeal_audit_events
  (appeal_id,event_kind,actor_staff_id,reviewer_staff_id)
 VALUES (NEW.appeal_id,'REVIEWER_ASSIGNED',NEW.assigned_by_staff_id,NEW.reviewer_staff_id);
 RETURN NULL;
END;
$$;
CREATE TRIGGER professional_appeal_assignment_audit
 AFTER INSERT ON professional_appeal_review_assignments
 FOR EACH ROW EXECUTE FUNCTION audit_professional_appeal_assignment();

CREATE FUNCTION audit_professional_appeal_decision()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO professional_appeal_audit_events
  (appeal_id,event_kind,actor_staff_id,reviewer_staff_id,outcome)
 VALUES (NEW.appeal_id,'APPEAL_DECIDED',NEW.reviewer_staff_id,NEW.reviewer_staff_id,NEW.outcome);
 RETURN NULL;
END;
$$;
CREATE TRIGGER professional_appeal_decision_audit
 AFTER INSERT ON professional_moderation_appeal_decisions
 FOR EACH ROW EXECUTE FUNCTION audit_professional_appeal_decision();

-- A direct INSERT cannot claim an event that does not match committed
-- source evidence. The AFTER triggers above are the ordinary writers.
CREATE FUNCTION guard_professional_appeal_audit_insert()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.event_kind='REVIEWER_ASSIGNED' THEN
  PERFORM 1 FROM professional_appeal_review_assignments a
  WHERE a.appeal_id=NEW.appeal_id AND a.assigned_by_staff_id=NEW.actor_staff_id
    AND a.reviewer_staff_id=NEW.reviewer_staff_id AND NEW.outcome IS NULL;
 ELSIF NEW.event_kind='APPEAL_DECIDED' THEN
  PERFORM 1 FROM professional_moderation_appeal_decisions d
  WHERE d.appeal_id=NEW.appeal_id AND d.reviewer_staff_id=NEW.actor_staff_id
    AND d.reviewer_staff_id=NEW.reviewer_staff_id AND d.outcome=NEW.outcome;
 ELSE
  RAISE EXCEPTION 'Invalid appeal audit event' USING ERRCODE='23514';
 END IF;
 IF NOT FOUND THEN
  RAISE EXCEPTION 'Appeal audit event lacks matching source evidence'
   USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER professional_appeal_audit_insert_guard
 BEFORE INSERT ON professional_appeal_audit_events
 FOR EACH ROW EXECUTE FUNCTION guard_professional_appeal_audit_insert();

CREATE FUNCTION reject_professional_appeal_audit_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'Appeal audit event is immutable' USING ERRCODE='23514';
END;
$$;
CREATE TRIGGER professional_appeal_audit_immutable
 BEFORE UPDATE OR DELETE ON professional_appeal_audit_events
 FOR EACH ROW EXECUTE FUNCTION reject_professional_appeal_audit_mutation();
