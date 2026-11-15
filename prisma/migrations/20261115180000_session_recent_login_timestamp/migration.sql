-- Existing sessions have no trustworthy issuance timestamp. Keep them NULL
-- so privileged primary-auth proof fails closed for legacy sessions.
-- New sessions receive the server-side issuance timestamp.
ALTER TABLE "sessions" ADD COLUMN "created_at" TIMESTAMPTZ(3);
ALTER TABLE "sessions" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;
