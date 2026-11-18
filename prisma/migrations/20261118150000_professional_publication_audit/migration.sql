-- Append-only publication intent audit. Do not edit existing immutable snapshot migrations.
CREATE TABLE professional_publication_audit (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 profile_id UUID NOT NULL REFERENCES professional_profiles(id) ON DELETE RESTRICT,
 actor_person_id UUID NOT NULL REFERENCES persons(id) ON DELETE RESTRICT,
 from_status VARCHAR(24) NOT NULL CHECK (from_status IN ('DRAFT','PUBLISHED')),
 from_version INTEGER NOT NULL CHECK (from_version >= 1),
 to_version INTEGER NOT NULL CHECK (to_version = from_version + 1),
 published_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(profile_id,to_version)
);
CREATE FUNCTION prevent_professional_publication_audit_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'Publication audit is append-only' USING ERRCODE='23514';
END;
$$;
CREATE TRIGGER professional_publication_audit_append_only
 BEFORE UPDATE OR DELETE ON professional_publication_audit
 FOR EACH ROW EXECUTE FUNCTION prevent_professional_publication_audit_change();
