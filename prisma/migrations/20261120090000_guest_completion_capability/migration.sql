-- Reserve the new purpose in its own committed migration.
-- PostgreSQL cannot use a newly added enum value in a CHECK until commit.
ALTER TYPE "GuestCapabilityScope" ADD VALUE IF NOT EXISTS 'COMPLETE_REQUEST';
