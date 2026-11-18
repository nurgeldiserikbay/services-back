CREATE TABLE professional_published_revisions (
 profile_id UUID NOT NULL REFERENCES professional_profiles(id) ON DELETE RESTRICT,
 version INTEGER NOT NULL CHECK (version >= 1),
 title VARCHAR(180),
 about VARCHAR(3000),
 captured_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY (profile_id, version)
);

-- Existing snapshots are the first known historical revisions. The captured
-- timestamp is migration time, not a fabricated original publication time.
INSERT INTO professional_published_revisions(profile_id,version,title,about)
 SELECT id,published_version,published_title,published_about
 FROM professional_profiles WHERE published_version IS NOT NULL;

CREATE FUNCTION protect_professional_published_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'Published revision is immutable' USING ERRCODE='23514';
END;
$$;
CREATE TRIGGER professional_revision_immutable
 BEFORE UPDATE OR DELETE ON professional_published_revisions
 FOR EACH ROW EXECUTE FUNCTION protect_professional_published_revision();

CREATE FUNCTION record_professional_published_revision() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE existing professional_published_revisions%ROWTYPE;
BEGIN
 IF NEW.published_version IS NULL THEN
  RETURN NEW;
 END IF;
 IF TG_OP='UPDATE' THEN
  IF OLD.published_version IS NOT NULL AND NEW.published_version < OLD.published_version THEN
   RAISE EXCEPTION 'Published version cannot decrease' USING ERRCODE='23514';
  END IF;
 END IF;
 INSERT INTO professional_published_revisions(profile_id,version,title,about)
 VALUES(NEW.id,NEW.published_version,NEW.published_title,NEW.published_about)
 ON CONFLICT(profile_id,version) DO NOTHING;
 SELECT * INTO existing FROM professional_published_revisions
 WHERE profile_id=NEW.id AND version=NEW.published_version;
 IF existing.title IS DISTINCT FROM NEW.published_title OR
    existing.about IS DISTINCT FROM NEW.published_about THEN
  RAISE EXCEPTION 'Published revision cannot change content' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER professional_profile_record_revision
 AFTER INSERT OR UPDATE OF published_version,published_title,published_about,status ON professional_profiles
 FOR EACH ROW EXECUTE FUNCTION record_professional_published_revision();
