-- Extend the append-only admin audit trail to MFA enrollment and login.
-- Events contain only actor/target staff UUIDs and an allowlisted action;
-- never log OTPs, factor ciphertext, session tokens, IPs or request payloads.
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
