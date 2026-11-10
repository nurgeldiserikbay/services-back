-- Scope grants must be tied to a concrete resource, not a wildcard.
-- The resolver accepts only typed resource UUIDs; reject malformed rows
-- at the database boundary as well.
ALTER TABLE "platform_admin_grants"
  ADD CONSTRAINT "platform_admin_grants_scope_format_check"
  CHECK ("scope" ~ '^[a-z][a-z0-9_-]{0,31}:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$');
ALTER TABLE "platform_moderation_cases"
  ADD CONSTRAINT "platform_moderation_cases_resource_scope_format_check"
  CHECK ("resource_scope" ~ '^[a-z][a-z0-9_-]{0,31}:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$');
