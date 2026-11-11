-- Reject malformed privileged session proofs and resource grants at rest.
-- Keep existing applied migrations immutable.
ALTER TABLE "platform_admin_sessions"
  ADD CONSTRAINT "platform_admin_sessions_token_hash_format_check"
  CHECK ("token_hash" ~ '^[0-9a-f]{64}$');
ALTER TABLE "platform_admin_grants"
  ADD CONSTRAINT "platform_admin_grants_scope_format_check"
  CHECK ("scope" ~ '^[a-z][a-z0-9_-]{0,31}:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$');
ALTER TABLE "platform_moderation_cases"
  ADD CONSTRAINT "platform_moderation_cases_resource_scope_format_check"
  CHECK ("resource_scope" ~ '^[a-z][a-z0-9_-]{0,31}:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$');
