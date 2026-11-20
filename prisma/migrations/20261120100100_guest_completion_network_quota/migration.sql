-- Treat guest completion OTP as a separate purpose while charging it against
-- the existing combined network abuse budget. Preserve existing purposes.
ALTER TABLE guest_otp_network_issuances
 DROP CONSTRAINT IF EXISTS guest_otp_network_issuances_purpose_check;
ALTER TABLE guest_otp_network_issuances
 ADD CONSTRAINT guest_otp_network_issuances_purpose_check
 CHECK (purpose IN ('CREATE_REQUEST','MANAGE_SCHEDULE','COMPLETE_REQUEST'));
