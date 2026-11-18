-- Defense in depth: ordinary first-instance decision evidence must never be
-- inserted against an appeal case, including through direct SQL or alternate
-- application paths. Independent appeal adjudication requires its own schema.
-- Forward only; do not rewrite previously applied migrations.
CREATE OR REPLACE FUNCTION enforce_professional_moderation_decision_insert()
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
 IF EXISTS(
  SELECT 1 FROM professional_moderation_appeals WHERE case_id=NEW.case_id
 ) THEN
  RAISE EXCEPTION 'Appeal requires separate adjudication evidence'
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
