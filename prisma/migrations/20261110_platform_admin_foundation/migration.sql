-- Dedicated privileged identity/session tables. No login or MFA enrollment is
-- enabled by this migration. Do not issue sessions without verified MFA.
CREATE TABLE "platform_admin_staff" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "role" VARCHAR(16) NOT NULL,
  "disabled_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "platform_admin_staff_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "platform_admin_staff_role_check"
    CHECK ("role" IN ('owner','admin','operator','auditor')),
  CONSTRAINT "platform_admin_staff_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "platform_admin_staff_user_id_key"
  ON "platform_admin_staff"("user_id");

CREATE TABLE "platform_admin_sessions" (
  "id" UUID NOT NULL,
  "staff_id" UUID NOT NULL,
  "token_hash" CHAR(64) NOT NULL,
  "mfa_verified_at" TIMESTAMPTZ(3) NOT NULL,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "revoked_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "platform_admin_sessions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "platform_admin_sessions_staff_id_fkey"
    FOREIGN KEY ("staff_id") REFERENCES "platform_admin_staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "platform_admin_sessions_valid_times"
    CHECK ("expires_at" > "created_at" AND
      "mfa_verified_at" <= "created_at" AND
      ("revoked_at" IS NULL OR "revoked_at" >= "created_at")),
  CONSTRAINT "platform_admin_sessions_token_hash_format"
    CHECK ("token_hash" ~ '^[0-9a-f]{64}$')
);
CREATE UNIQUE INDEX "platform_admin_sessions_token_hash_key"
  ON "platform_admin_sessions"("token_hash");
CREATE INDEX "platform_admin_sessions_staff_id_expires_at_idx"
  ON "platform_admin_sessions"("staff_id","expires_at");

CREATE TABLE "platform_admin_grants" (
  "id" UUID NOT NULL,
  "staff_id" UUID NOT NULL,
  "scope" VARCHAR(80) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "platform_admin_grants_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "platform_admin_grants_staff_id_fkey"
    FOREIGN KEY ("staff_id") REFERENCES "platform_admin_staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "platform_admin_grants_staff_id_scope_key"
  ON "platform_admin_grants"("staff_id","scope");
