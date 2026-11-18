-- Serialize creation and reactivation of an operational assignment with
-- publication, which locks professional_profiles FOR UPDATE first.
-- The profile row lock is deliberately shared across all assignment writers.
-- This is a concurrency invariant, NOT authorization to enable publication.
CREATE FUNCTION lock_professional_for_active_assignment() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.status IN ('PROPOSED', 'ACCEPTED') AND
    (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status OR
     OLD.professional_id IS DISTINCT FROM NEW.professional_id) THEN
  PERFORM 1 FROM professional_profiles
   WHERE id=NEW.professional_id
   FOR SHARE;
  IF NOT FOUND THEN
   RAISE EXCEPTION 'Professional profile unavailable' USING ERRCODE='23503';
  END IF;
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER service_assignment_profile_publication_lock
 BEFORE INSERT OR UPDATE OF status,professional_id ON service_assignments
 FOR EACH ROW EXECUTE FUNCTION lock_professional_for_active_assignment();
