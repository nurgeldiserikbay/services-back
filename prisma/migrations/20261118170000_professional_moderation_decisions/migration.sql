-- Prepared, append-only decision evidence. This migration DOES NOT
-- authorize a moderator action or unblock professional publication.
CREATE TABLE professional_moderation_decisions (
 id UUID PRIMARY KEY,
 case_id UUID NOT NULL REFERENCES platform_moderation_cases(id) ON DELETE RESTRICT,
 profile_id UUID NOT NULL REFERENCES professional_profiles(id) ON DELETE RESTRICT,
 profile_version INTEGER NOT NULL CHECK(profile_version>=1),
 actor_staff_id UUID NOT NULL REFERENCES platform_admin_staff(id) ON DELETE RESTRICT,
 decision VARCHAR(16) NOT NULL CHECK(decision IN ('APPROVE','REJECT')),
 decided_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(case_id)
);
CREATE INDEX professional_moderation_decisions_profile_version_idx
 ON professional_moderation_decisions(profile_id,profile_version,decided_at DESC);

-- Enforce a typed, exact resource target and decision-version snapshot in the
-- same database transaction; an unrelated/unfinished case never yields evidence.
CREATE FUNCTION enforce_professional_moderation_decision_insert()
 RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE case_row RECORD;
DECLARE current_version INTEGER;
BEGIN
 SELECT resource_scope,subject_kind,state INTO case_row
 FROM platform_moderation_cases WHERE id=NEW.case_id FOR SHARE;
 IF NOT FOUND OR case_row.subject_kind<>'professional' OR
    case_row.resource_scope<>('professional:'||NEW.profile_id::text) OR
    case_row.state<>'closed' THEN
  RAISE EXCEPTION 'Moderation decision requires a closed matching professional case'
   USING ERRCODE='23514';
 END IF;
 SELECT version INTO current_version FROM professional_profiles
 WHERE id=NEW.profile_id FOR SHARE;
 IF NOT FOUND OR current_version<>NEW.profile_version THEN
  RAISE EXCEPTION 'Moderation decision requires current profile revision'
   USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER professional_moderation_decision_insert_guard
 BEFORE INSERT ON professional_moderation_decisions
 FOR EACH ROW EXECUTE FUNCTION enforce_professional_moderation_decision_insert();

CREATE FUNCTION prevent_professional_moderation_decision_mutation()
 RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'Moderation decision evidence is immutable' USING ERRCODE='23514';
END;
$$;
CREATE TRIGGER professional_moderation_decision_immutable
 BEFORE UPDATE OR DELETE ON professional_moderation_decisions
 FOR EACH ROW EXECUTE FUNCTION prevent_professional_moderation_decision_mutation();
