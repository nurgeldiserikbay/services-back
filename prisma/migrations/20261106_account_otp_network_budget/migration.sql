-- Private account OTP send budget; no raw IP addresses or authentication tokens.
-- Network digest is generated only by a verified trusted ingress.
CREATE TABLE account_otp_network_issuances (
  id UUID PRIMARY KEY,
  network_digest VARCHAR(64) NOT NULL,
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT account_otp_network_digest_format
    CHECK (network_digest ~ '^[0-9a-f]{64}$')
);
CREATE INDEX account_otp_network_issuances_digest_created_idx
  ON account_otp_network_issuances(network_digest,created_at);
CREATE INDEX account_otp_network_issuances_created_idx
  ON account_otp_network_issuances(created_at);
-- Prune by approved retention scheduler after rolling 24h (+ safety margin).
