-- Extend the existing append-only audit action allowlist for MFA lifecycle.
-- Keep the original applied migration immutable; this is additive.
ALTER TABLE "platform_admin_security_events"
  DROP CONSTRAINT "platform_admin_security_events_action_allowed";

ALTER TABLE "platform_admin_security_events"
  ADD CONSTRAINT "platform_admin_security_events_action_allowed"
  CHECK ("action" IN (
    'totp_factor_revoked',
    'totp_factor_activated',
    'totp_activation_failed',
    'admin_mfa_login_succeeded',
    'admin_mfa_login_failed'
  ));
