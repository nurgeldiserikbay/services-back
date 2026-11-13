-- Encrypted TOTP factors; AES-GCM key is managed outside PostgreSQL.
-- Enrollment and login endpoints remain disabled pending primary authentication,
-- key rotation, audit logging, and recovery policy.
CREATE TABLE "platform_admin_totp_factors" (
  "staff_id" UUID PRIMARY KEY REFERENCES "platform_admin_staff"("id") ON DELETE CASCADE,
  "encrypted_secret" TEXT NOT NULL,
  "key_version" VARCHAR(64) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "activated_at" TIMESTAMPTZ(3),
  "disabled_at" TIMESTAMPTZ(3),
  CONSTRAINT "platform_admin_totp_factors_envelope_size"
    CHECK (octet_length("encrypted_secret") BETWEEN 32 AND 512),
  CONSTRAINT "platform_admin_totp_factors_key_version_size"
    CHECK (length("key_version") BETWEEN 1 AND 64),
  CONSTRAINT "platform_admin_totp_factors_active_state"
    CHECK ("activated_at" IS NULL OR "activated_at" >= "created_at")
);
