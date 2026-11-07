-- Minimal, redacted moderation queue projection. Never store evidence or contacts.
CREATE TABLE platform_moderation_cases (
 id uuid PRIMARY KEY,
 resource_scope varchar(80) NOT NULL
   CHECK (resource_scope ~ '^[a-z][a-z0-9_-]{0,31}:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
 subject_kind varchar(24) NOT NULL
   CHECK (subject_kind IN ('professional','organization','review','affiliation')),
 state varchar(16) NOT NULL
   CHECK (state IN ('triage','in_review','decision','appeal','closed')),
 created_at timestamptz(3) NOT NULL DEFAULT now()
);
CREATE INDEX platform_moderation_cases_scope_created_idx
 ON platform_moderation_cases(resource_scope,created_at DESC);
