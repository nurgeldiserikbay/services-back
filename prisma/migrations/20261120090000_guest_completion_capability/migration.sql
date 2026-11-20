-- Separate guest completion authority from READ_CANCEL and MANAGE_SCHEDULE.
-- Existing capabilities do not gain completion rights automatically.
ALTER TYPE "GuestCapabilityScope" ADD VALUE IF NOT EXISTS 'COMPLETE_REQUEST';
