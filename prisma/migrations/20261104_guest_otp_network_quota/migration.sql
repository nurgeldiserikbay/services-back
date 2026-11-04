-- Anonymous, keyed network buckets only; raw IPs and forwarding headers
-- must never be written into this table. Records expire after 24h.
CREATE TABLE guest_otp_network_events (
  id uuid PRIMARY KEY,
  network_digest char(64) NOT NULL,
  challenge_id uuid NOT NULL UNIQUE REFERENCES guest_challenges(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT guest_otp_network_digest_valid CHECK (network_digest ~ '^[a-f0-9]{64}$')
);
CREATE INDEX guest_otp_network_events_quota_idx
  ON guest_otp_network_events(network_digest,created_at DESC);
