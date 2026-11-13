-- Minimal immutable security audit trail. No bearer tokens, OTPs or secrets.
CREATE TABLE "platform_admin_security_events" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "actor_staff_id" UUID NOT NULL REFERENCES "platform_admin_staff"("id") ON DELETE RESTRICT,
  "target_staff_id" UUID NOT NULL REFERENCES "platform_admin_staff"("id") ON DELETE RESTRICT,
  "action" VARCHAR(64) NOT NULL,
  "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "platform_admin_security_events_action_allowed"
    CHECK ("action" IN ('totp_factor_revoked'))
);
CREATE INDEX "platform_admin_security_events_target_occurred_idx"
  ON "platform_admin_security_events" ("target_staff_id","occurred_at");
