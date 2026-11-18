-- Moderation case opening must serialize with owner publication, which
-- locks professional_profiles FOR UPDATE before reading outstanding cases.
-- Also prevent rewriting an adjudicated case after immutable decision evidence.
-- No new moderation workflow or publication authorization is introduced.
CREATE FUNCTION guard_professional_moderation_case_transition()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_uuid uuid;
BEGIN
 IF TG_OP='UPDATE' AND EXISTS(
  SELECT 1 FROM professional_moderation_decisions WHERE case_id=OLD.id
 ) THEN
  RAISE EXCEPTION 'Adjudicated moderation case is immutable; open a separate appeal case'
    USING ERRCODE='23514';
 END IF;
 IF NEW.subject_kind='professional' AND NEW.state<>'closed' AND
    NEW.resource_scope ~ '^professional:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
 THEN
  -- An UPDATE that leaves the open case on the same target does not need a
  -- second lock. INSERT and a re-open/retarget both acquire a shared lock.
  IF TG_OP='INSERT' OR
     (TG_OP='UPDATE' AND (
       OLD.state IS DISTINCT FROM NEW.state OR
       OLD.resource_scope IS DISTINCT FROM NEW.resource_scope OR
       OLD.subject_kind IS DISTINCT FROM NEW.subject_kind
     ))
  THEN
   target_uuid=substring(NEW.resource_scope from 14)::uuid;
   -- Legacy orphaned scope-only queue fixtures do not have a profile FK.
   -- A matching real profile always participates in this lock protocol.
   PERFORM 1 FROM professional_profiles WHERE id=target_uuid FOR SHARE;
  END IF;
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER professional_moderation_case_publication_guard
 BEFORE INSERT OR UPDATE OF state,resource_scope,subject_kind
 ON platform_moderation_cases
 FOR EACH ROW EXECUTE FUNCTION guard_professional_moderation_case_transition();
