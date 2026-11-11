-- Additive migration for platform admin access and redacted moderation projection.
-- Do not rewrite the pinned 20261103 baseline migration.
CREATE TABLE IF NOT EXISTS "platform_admin_staff" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "role" VARCHAR(16) NOT NULL,
  "disabled_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "platform_admin_staff_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "platform_admin_staff_user_id_key"
  ON "platform_admin_staff"("user_id");
CREATE TABLE IF NOT EXISTS "platform_admin_sessions" (
  "id" UUID NOT NULL,
  "staff_id" UUID NOT NULL,
  "token_hash" CHAR(64) NOT NULL,
  "mfa_verified_at" TIMESTAMPTZ(3) NOT NULL,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "revoked_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "platform_admin_sessions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "platform_admin_sessions_token_hash_key"
  ON "platform_admin_sessions"("token_hash");
CREATE INDEX IF NOT EXISTS "platform_admin_sessions_staff_id_expires_at_idx"
  ON "platform_admin_sessions"("staff_id","expires_at");
CREATE TABLE IF NOT EXISTS "platform_admin_grants" (
  "id" UUID NOT NULL,
  "staff_id" UUID NOT NULL,
  "scope" VARCHAR(80) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "platform_admin_grants_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "platform_admin_grants_staff_id_scope_key"
  ON "platform_admin_grants"("staff_id","scope");
CREATE TABLE IF NOT EXISTS "platform_moderation_cases" (
  "id" UUID NOT NULL,
  "resource_scope" VARCHAR(80) NOT NULL,
  "subject_kind" VARCHAR(24) NOT NULL,
  "state" VARCHAR(16) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "platform_moderation_cases_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "platform_moderation_cases_resource_scope_created_at_idx"
  ON "platform_moderation_cases"("resource_scope","created_at");
DO $constraints$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='platform_admin_staff_user_id_fkey') THEN
    ALTER TABLE "platform_admin_staff" ADD CONSTRAINT "platform_admin_staff_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='platform_admin_sessions_staff_id_fkey') THEN
    ALTER TABLE "platform_admin_sessions" ADD CONSTRAINT "platform_admin_sessions_staff_id_fkey"
      FOREIGN KEY ("staff_id") REFERENCES "platform_admin_staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='platform_admin_grants_staff_id_fkey') THEN
    ALTER TABLE "platform_admin_grants" ADD CONSTRAINT "platform_admin_grants_staff_id_fkey"
      FOREIGN KEY ("staff_id") REFERENCES "platform_admin_staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END
$constraints$;
