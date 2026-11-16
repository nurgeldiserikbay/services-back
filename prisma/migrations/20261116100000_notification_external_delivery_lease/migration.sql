-- A lease is an exclusive, time-bounded claim only; it does not prove provider delivery.
-- Every new claim gets a fresh UUID fencing token. Stale workers must not be allowed
-- to acknowledge a subsequent claim. Never store recipient PII in the lease.
ALTER TABLE notification_deliveries
  ADD COLUMN lease_token uuid,
  ADD COLUMN lease_expires_at timestamptz(3);

ALTER TABLE notification_deliveries
  ADD CONSTRAINT notification_deliveries_lease_pair_chk
  CHECK ((lease_token IS NULL) = (lease_expires_at IS NULL));

-- A non-partial index has a stable pg_dump/pg_restore representation.
-- The query still filters external PENDING deliveries explicitly.
CREATE INDEX notification_deliveries_external_lease_idx
  ON notification_deliveries (state, next_attempt_at, lease_expires_at, id);
