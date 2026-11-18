ALTER TABLE professional_profiles
  ADD COLUMN about VARCHAR(3000),
  ADD COLUMN version INTEGER NOT NULL DEFAULT 1,
  ADD CONSTRAINT professional_profile_positive_version CHECK (version >= 1);
