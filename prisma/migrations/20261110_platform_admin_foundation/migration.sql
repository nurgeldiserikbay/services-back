-- Earlier migrations 20261108120000 and 20261108120100 already create
-- platform_admin_staff, platform_admin_sessions, platform_admin_grants,
-- and platform_moderation_cases. Do not recreate those tables or indexes.
-- Preserve existing data and add only the session validity invariant introduced
-- by the admin foundation work. No MFA provisioning is enabled here.
--
-- IMPORTANT: if this migration has already been applied in an environment,
-- reconcile its Prisma migration checksum/history before deploying this edit.
ALTER TABLE "platform_admin_sessions"
  ADD CONSTRAINT "platform_admin_sessions_valid_times"
  CHECK ("expires_at" > "created_at"
    AND "mfa_verified_at" <= "created_at"
    AND ("revoked_at" IS NULL OR "revoked_at" >= "created_at"));
