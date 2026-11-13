-- Durable, per-staff MFA failure counters. No public login endpoint is enabled.
-- The caller must enforce an independent per-IP / per-account throttle as well.
CREATE TABLE "platform_admin_mfa_attempts" (
  "staff_id" UUID PRIMARY KEY REFERENCES "platform_admin_staff"("id") ON DELETE CASCADE,
  "window_started_at" TIMESTAMPTZ(3) NOT NULL,
  "failed_attempts" INTEGER NOT NULL DEFAULT 0,
  "locked_until" TIMESTAMPTZ(3),
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "platform_admin_mfa_attempts_count_valid"
    CHECK ("failed_attempts" BETWEEN 0 AND 5)
);
