-- Preserve the currently visible content before owner draft edits.
ALTER TABLE professional_profiles
 ADD COLUMN published_title VARCHAR(180),
 ADD COLUMN published_about VARCHAR(3000),
 ADD COLUMN published_version INTEGER,
 ADD CONSTRAINT professional_profile_snapshot_version CHECK (
  published_version IS NULL OR (published_version >= 1 AND published_version <= version)
 );
UPDATE professional_profiles
 SET published_title=title,published_about=about,published_version=version
 WHERE status='PUBLISHED';

-- Existing trusted publication writers and seed fixtures continue to capture
-- their initial snapshot. Owner PATCH never changes the status or snapshot.
CREATE FUNCTION capture_professional_public_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.status='PUBLISHED' THEN
  IF TG_OP='INSERT' THEN
   NEW.published_title:=NEW.title;
   NEW.published_about:=NEW.about;
   NEW.published_version:=NEW.version;
  ELSIF OLD.status<>'PUBLISHED' THEN
   NEW.published_title:=NEW.title;
   NEW.published_about:=NEW.about;
   NEW.published_version:=NEW.version;
  END IF;
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER professional_profile_capture_snapshot
 BEFORE INSERT OR UPDATE OF status ON professional_profiles
 FOR EACH ROW EXECUTE FUNCTION capture_professional_public_snapshot();
