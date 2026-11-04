-- Infrastructure-only OTP network budget ledger.
-- Stores only a keyed network digest (never IP, raw headers, contact or OTP).
-- This table is managed by SQL migrations and queried through pg, not Prisma.
CREATE TABLE guest_otp_network_issuances (
  id UUID NOT NULL PRIMARY KEY,
  network_digest VARCHAR(64) NOT NULL,
  purpose VARCHAR(32) NOT NULL CHECK (purpose='CREATE_REQUEST'),
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT guest_otp_network_digest_format
    CHECK (network_digest ~ '^[0-9a-f]{64}$')
);
CREATE INDEX guest_otp_network_issuances_digest_created_idx
  ON guest_otp_network_issuances(network_digest,created_at);
CREATE INDEX guest_otp_network_issuances_created_idx
  ON guest_otp_network_issuances(created_at);
-- Retention: purge rows older than 24h + operational safety margin through
-- approved maintenance job; do not log IP or persist raw network assertions.
