-- Optimize the scoped moderation queue's deterministic newest-first ordering.
-- Preserve historical migrations and the pinned baseline.
CREATE INDEX IF NOT EXISTS "platform_moderation_cases_scope_newest_idx"
  ON "platform_moderation_cases" ("resource_scope", "created_at" DESC, "id" DESC);
