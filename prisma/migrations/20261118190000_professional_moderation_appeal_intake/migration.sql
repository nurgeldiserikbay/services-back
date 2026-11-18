-- Append-only owner appeal intake for an explicitly rejected professional.
-- An appeal creates a NEW open moderation case; original decision is immutable.
-- This is NOT an automatic approval nor a final appeal resolution workflow.
CREATE TABLE professional_moderation_appeals (
 id uuid PRIMARY KEY,
 original_decision_id uuid NOT NULL UNIQUE REFERENCES professional_moderation_decisions(id) ON DELETE RESTRICT,
 case_id uuid NOT NULL UNIQUE REFERENCES platform_moderation_cases(id) ON DELETE RESTRICT,
 profile_id uuid NOT NULL REFERENCES professional_profiles(id) ON DELETE RESTRICT,
 profile_version integer NOT NULL CHECK(profile_version >= 1),
 submitted_by_person_id uuid NOT NULL REFERENCES persons(id) ON DELETE RESTRICT,
 submitted_at timestamptz(3) NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX professional_moderation_appeals_profile_submitted_idx
 ON professional_moderation_appeals(profile_id,submitted_at DESC);

CREATE FUNCTION guard_professional_moderation_appeal_insert()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE evidence record;
DECLARE case_row record;
DECLARE owner_row record;
BEGIN
 SELECT decision,profile_id,profile_version INTO evidence
 FROM professional_moderation_decisions
 WHERE id=NEW.original_decision_id FOR SHARE;
 IF NOT FOUND OR evidence.decision<>'REJECT' OR
    evidence.profile_id<>NEW.profile_id OR evidence.profile_version<>NEW.profile_version THEN
  RAISE EXCEPTION 'Appeal must target matching REJECT evidence' USING ERRCODE='23514';
 END IF;
 SELECT person_id,version INTO owner_row FROM professional_profiles
 WHERE id=NEW.profile_id FOR SHARE;
 IF NOT FOUND OR owner_row.person_id<>NEW.submitted_by_person_id OR
    owner_row.version<>NEW.profile_version THEN
  RAISE EXCEPTION 'Appeal must come from current profile owner and version' USING ERRCODE='23514';
 END IF;
 SELECT resource_scope,subject_kind,state INTO case_row
 FROM platform_moderation_cases WHERE id=NEW.case_id FOR SHARE;
 IF NOT FOUND OR case_row.resource_scope<>('professional:'||NEW.profile_id::text) OR
    case_row.subject_kind<>'professional' OR case_row.state<>'appeal' THEN
  RAISE EXCEPTION 'Appeal must create matching open case' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER professional_moderation_appeal_insert_guard
 BEFORE INSERT ON professional_moderation_appeals
 FOR EACH ROW EXECUTE FUNCTION guard_professional_moderation_appeal_insert();

CREATE FUNCTION prevent_professional_moderation_appeal_change()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'Appeal intake evidence is immutable' USING ERRCODE='23514';
END;
$$;
CREATE TRIGGER professional_moderation_appeal_immutable
 BEFORE UPDATE OR DELETE ON professional_moderation_appeals
 FOR EACH ROW EXECUTE FUNCTION prevent_professional_moderation_appeal_change();
