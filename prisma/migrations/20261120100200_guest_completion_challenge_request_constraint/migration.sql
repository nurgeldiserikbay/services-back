-- Keep request-scoped OTP purposes bound to an existing request.
-- CREATE_REQUEST is the only unbound challenge. A completion challenge cannot
-- be issued without an original request and contact.
ALTER TABLE guest_challenges
 DROP CONSTRAINT IF EXISTS guest_challenge_request_purpose_valid;
ALTER TABLE guest_challenges
 ADD CONSTRAINT guest_challenge_request_purpose_valid CHECK (
  (purpose='CREATE_REQUEST' AND request_id IS NULL)
  OR (purpose IN ('RECOVER_REQUEST','MANAGE_SCHEDULE','COMPLETE_REQUEST')
      AND request_id IS NOT NULL)
 );
