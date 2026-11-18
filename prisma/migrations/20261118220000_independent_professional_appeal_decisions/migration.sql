-- Prepared immutable *separate* appeal outcome evidence. No HTTP route,
-- admin operation or publication permission is activated by this migration.
CREATE TABLE professional_moderation_appeal_decisions (
 id UUID PRIMARY KEY,
 appeal_id UUID NOT NULL UNIQUE REFERENCES professional_moderation_appeals(id) ON DELETE RESTRICT,
 reviewer_staff_id UUID NOT NULL REFERENCES platform_admin_staff(id) ON DELETE RESTRICT,
 outcome VARCHAR(24) NOT NULL CHECK (outcome IN ('UPHOLD_REJECTION','OVERTURN_REJECTION')),
 decided_at TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX professional_appeal_decisions_reviewer_idx
 ON professional_moderation_appeal_decisions(reviewer_staff_id,decided_at DESC);

CREATE FUNCTION guard_professional_moderation_appeal_decision_insert()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE appeal_row RECORD;
DECLARE original_row RECORD;
DECLARE case_row RECORD;
DECLARE current_version INTEGER;
BEGIN
 SELECT original_decision_id,case_id,profile_id,profile_version INTO appeal_row
 FROM professional_moderation_appeals WHERE id=NEW.appeal_id FOR SHARE;
 IF NOT FOUND THEN
  RAISE EXCEPTION 'Appeal evidence missing' USING ERRCODE='23514';
 END IF;
 SELECT decision,actor_staff_id,profile_id,profile_version INTO original_row
 FROM professional_moderation_decisions WHERE id=appeal_row.original_decision_id FOR SHARE;
 IF NOT FOUND OR original_row.decision<>'REJECT' OR
    original_row.profile_id<>appeal_row.profile_id OR
    original_row.profile_version<>appeal_row.profile_version OR
    original_row.actor_staff_id=NEW.reviewer_staff_id THEN
  RAISE EXCEPTION 'Independent reviewer and original rejection required'
   USING ERRCODE='23514';
 END IF;
 SELECT resource_scope,subject_kind,state INTO case_row
 FROM platform_moderation_cases WHERE id=appeal_row.case_id FOR SHARE;
 IF NOT FOUND OR case_row.resource_scope<>('professional:'||appeal_row.profile_id::text)
  OR case_row.subject_kind<>'professional' OR case_row.state<>'closed' THEN
  RAISE EXCEPTION 'Appeal decision requires matching closed appeal case'
   USING ERRCODE='23514';
 END IF;
 SELECT version INTO current_version FROM professional_profiles
 WHERE id=appeal_row.profile_id FOR SHARE;
 IF NOT FOUND OR current_version<>appeal_row.profile_version THEN
  RAISE EXCEPTION 'Appeal decision requires current profile revision'
   USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER professional_moderation_appeal_decision_insert_guard
 BEFORE INSERT ON professional_moderation_appeal_decisions
 FOR EACH ROW EXECUTE FUNCTION guard_professional_moderation_appeal_decision_insert();

CREATE FUNCTION reject_professional_moderation_appeal_decision_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'Appeal decision evidence is immutable' USING ERRCODE='23514';
END;
$$;
CREATE TRIGGER professional_moderation_appeal_decision_immutable
 BEFORE UPDATE OR DELETE ON professional_moderation_appeal_decisions
 FOR EACH ROW EXECUTE FUNCTION reject_professional_moderation_appeal_decision_mutation();

-- A finalized appeal case must remain tied to its immutable outcome.
-- No state/scope/type changes (including a no-op update) after evidence exists.
CREATE FUNCTION reject_decided_professional_appeal_case_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(
  SELECT 1 FROM professional_moderation_appeals a
  JOIN professional_moderation_appeal_decisions d ON d.appeal_id=a.id
  WHERE a.case_id=OLD.id
 ) THEN
  RAISE EXCEPTION 'Decided appeal case is immutable' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER decided_professional_appeal_case_immutable
 BEFORE UPDATE OF state,resource_scope,subject_kind ON platform_moderation_cases
 FOR EACH ROW EXECUTE FUNCTION reject_decided_professional_appeal_case_mutation();
