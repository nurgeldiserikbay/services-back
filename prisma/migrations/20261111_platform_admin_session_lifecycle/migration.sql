-- Ensure privileged sessions have a coherent lifetime at rest.
-- Do not constrain revoked_at: historical revocation may occur after expiry.
ALTER TABLE "platform_admin_sessions"
  ADD CONSTRAINT "platform_admin_sessions_lifetime_check"
  CHECK ("expires_at" > "created_at");
ALTER TABLE "platform_admin_sessions"
  ADD CONSTRAINT "platform_admin_sessions_mfa_before_expiry_check"
  CHECK ("mfa_verified_at" < "expires_at");
