-- Add independently typed OTP challenge for guest completion, in a standalone
-- committed migration (PostgreSQL enum values cannot be consumed before commit).
ALTER TYPE "GuestChallengePurpose" ADD VALUE IF NOT EXISTS 'COMPLETE_REQUEST';
