-- Dedicated platform administrator identity, sessions and resource grants.
-- Admin provisioning/session issuance MUST remain disabled until audited MFA
-- enrollment and a reviewed privileged onboarding process are implemented.
CREATE TABLE platform_admin_staff (
 id uuid PRIMARY KEY,
 user_id uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE RESTRICT,
 role varchar(16) NOT NULL CHECK(role IN ('owner','admin','operator','auditor')),
 disabled_at timestamptz(3),
 created_at timestamptz(3) NOT NULL DEFAULT now()
);
CREATE TABLE platform_admin_sessions (
 id uuid PRIMARY KEY,
 staff_id uuid NOT NULL REFERENCES platform_admin_staff(id) ON DELETE RESTRICT,
 token_hash char(64) NOT NULL UNIQUE CHECK(token_hash ~ '^[0-9a-f]{64}$'),
 mfa_verified_at timestamptz(3) NOT NULL,
 expires_at timestamptz(3) NOT NULL,
 revoked_at timestamptz(3),
 created_at timestamptz(3) NOT NULL DEFAULT now(),
 CONSTRAINT platform_admin_session_expiry CHECK(expires_at>created_at)
);
CREATE INDEX platform_admin_sessions_staff_expiry_idx ON platform_admin_sessions(staff_id,expires_at);
CREATE TABLE platform_admin_grants (
 id uuid PRIMARY KEY,
 staff_id uuid NOT NULL REFERENCES platform_admin_staff(id) ON DELETE RESTRICT,
 scope varchar(80) NOT NULL CHECK(scope ~ '^[a-z][a-z0-9_-]{0,31}:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
 created_at timestamptz(3) NOT NULL DEFAULT now(),
 UNIQUE(staff_id,scope)
);
-- Store HMAC hashes only, never raw bearer values. Recheck current DB
-- revocation and grants on EVERY request, not just at login.
