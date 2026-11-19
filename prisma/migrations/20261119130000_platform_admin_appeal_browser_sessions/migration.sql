-- Prepared browser BFF session persistence. This is separate from platform admin
-- bearer tokens and stores ONLY a domain-separated HMAC of the opaque cookie.
-- The application must keep all appeal BFF routes disabled until an authorized
-- transactional issuance/revocation/lookup adapter is implemented and reviewed.
CREATE TABLE "platform_admin_appeal_browser_sessions" (
    "id" UUID NOT NULL,
    "staff_id" UUID NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "platform_admin_appeal_browser_sessions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "platform_admin_appeal_browser_sessions_token_hash_key"
    ON "platform_admin_appeal_browser_sessions"("token_hash");

CREATE INDEX "platform_admin_appeal_browser_sessions_staff_id_expires_at_idx"
    ON "platform_admin_appeal_browser_sessions"("staff_id","expires_at");

ALTER TABLE "platform_admin_appeal_browser_sessions"
    ADD CONSTRAINT "platform_admin_appeal_browser_sessions_staff_id_fkey"
    FOREIGN KEY ("staff_id") REFERENCES "platform_admin_staff"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
