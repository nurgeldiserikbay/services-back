-- Preserve existing unbound CREATE_REQUEST and RECOVER_REQUEST challenges.
-- Only write-authority MANAGE_SCHEDULE and COMPLETE_REQUEST OTP challenges
-- are request-specific. Never require an ID for contact recovery.
ALTER TABLE guest_challenges
 DROP CONSTRAINT IF EXISTS guest_challenge_request_purpose_valid;
ALTER TABLE guest_challenges
 ADD CONSTRAINT guest_challenge_request_purpose_valid CHECK (
  (purpose IN ('CREATE_REQUEST','RECOVER_REQUEST') AND request_id IS NULL)
  OR (purpose IN ('MANAGE_SCHEDULE','COMPLETE_REQUEST')
      AND request_id IS NOT NULL)
 );
