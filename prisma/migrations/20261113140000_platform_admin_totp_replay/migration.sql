-- Server-side replay watermark for provisioned privileged TOTP factors.
-- Does not provision secrets, authenticate primary credentials, or expose login.
-- Secret material must be stored in a separately reviewed encrypted vault.
CREATE TABLE "platform_admin_totp_replay" (
  "staff_id" UUID PRIMARY KEY REFERENCES "platform_admin_staff"("id") ON DELETE CASCADE,
  "last_consumed_counter" BIGINT NOT NULL DEFAULT -1,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "platform_admin_totp_replay_counter_valid"
    CHECK ("last_consumed_counter" >= -1)
);
