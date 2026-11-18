-- Prepared reviewer assignment evidence only. No HTTP assignment endpoint.
-- Independent appeal adjudication is NOT authorized for production.
CREATE TABLE professional_appeal_review_assignments (
 appeal_id UUID PRIMARY KEY REFERENCES professional_moderation_appeals(id) ON DELETE RESTRICT,
 reviewer_staff_id UUID NOT NULL REFERENCES platform_admin_staff(id) ON DELETE RESTRICT,
 assigned_by_staff_id UUID NOT NULL REFERENCES platform_admin_staff(id) ON DELETE RESTRICT,
 assigned_at TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
 CONSTRAINT professional_appeal_assignment_distinct_actors CHECK(reviewer_staff_id<>assigned_by_staff_id)
);
CREATE INDEX professional_appeal_assignment_reviewer_idx
 ON professional_appeal_review_assignments(reviewer_staff_id,assigned_at DESC);

CREATE FUNCTION guard_professional_appeal_reviewer_assignment()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE appeal_row RECORD;
DECLARE rejection_actor UUID;
DECLARE state_value VARCHAR(16);
BEGIN
 SELECT a.case_id,a.profile_id,a.profile_version,d.actor_staff_id INTO appeal_row
 FROM professional_moderation_appeals a
 JOIN professional_moderation_decisions d ON d.id=a.original_decision_id
 WHERE a.id=NEW.appeal_id FOR SHARE OF a,d;
 IF NOT FOUND OR appeal_row.actor_staff_id=NEW.reviewer_staff_id OR
    appeal_row.actor_staff_id=NEW.assigned_by_staff_id THEN
  RAISE EXCEPTION 'Appeal assignment requires three distinct staff identities'
   USING ERRCODE='23514';
 END IF;
 PERFORM 1 FROM professional_profiles
 WHERE id=appeal_row.profile_id AND version=appeal_row.profile_version FOR SHARE;
 IF NOT FOUND THEN
  RAISE EXCEPTION 'Appeal assignment must match current profile revision'
   USING ERRCODE='23514';
 END IF;
 SELECT state INTO state_value FROM platform_moderation_cases
 WHERE id=appeal_row.case_id FOR SHARE;
 IF NOT FOUND OR state_value NOT IN ('appeal','decision') THEN
  RAISE EXCEPTION 'Appeal assignment requires open review' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER professional_appeal_assignment_insert_guard
 BEFORE INSERT ON professional_appeal_review_assignments
 FOR EACH ROW EXECUTE FUNCTION guard_professional_appeal_reviewer_assignment();

CREATE FUNCTION reject_professional_appeal_assignment_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'Reviewer assignment immutable' USING ERRCODE='23514';
END;
$$;
CREATE TRIGGER professional_appeal_assignment_immutable
 BEFORE UPDATE OR DELETE ON professional_appeal_review_assignments
 FOR EACH ROW EXECUTE FUNCTION reject_professional_appeal_assignment_mutation();

-- Direct SQL must not bypass assignment verification when inserting outcome.
CREATE FUNCTION guard_professional_appeal_outcome_assignment()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE assignee UUID;
BEGIN
 SELECT reviewer_staff_id INTO assignee FROM professional_appeal_review_assignments
 WHERE appeal_id=NEW.appeal_id FOR SHARE;
 IF NOT FOUND OR assignee<>NEW.reviewer_staff_id THEN
  RAISE EXCEPTION 'Appeal outcome requires assigned independent reviewer'
   USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER professional_appeal_outcome_assignment_guard
 BEFORE INSERT ON professional_moderation_appeal_decisions
 FOR EACH ROW EXECUTE FUNCTION guard_professional_appeal_outcome_assignment();
