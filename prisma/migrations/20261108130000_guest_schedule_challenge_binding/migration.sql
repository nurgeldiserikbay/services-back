-- Schedule reverification challenges must be bound to one guest request.
-- CREATE_REQUEST challenges intentionally leave request_id NULL.
ALTER TABLE guest_challenges
  ADD COLUMN request_id UUID;

ALTER TABLE guest_challenges
  ADD CONSTRAINT guest_challenges_request_id_fkey
  FOREIGN KEY (request_id) REFERENCES service_requests(id)
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX guest_challenges_request_id_purpose_expires_at_idx
  ON guest_challenges(request_id, purpose, expires_at);

ALTER TABLE guest_otp_network_issuances
  DROP CONSTRAINT guest_otp_network_issuances_purpose_check;
ALTER TABLE guest_otp_network_issuances
  ADD CONSTRAINT guest_otp_network_issuances_purpose_check
  CHECK (purpose IN ('CREATE_REQUEST','MANAGE_SCHEDULE'));

ALTER TABLE guest_challenges
  ADD CONSTRAINT guest_challenge_request_purpose_valid
  CHECK ((purpose = 'MANAGE_SCHEDULE' AND request_id IS NOT NULL)
      OR (purpose <> 'MANAGE_SCHEDULE' AND request_id IS NULL));
