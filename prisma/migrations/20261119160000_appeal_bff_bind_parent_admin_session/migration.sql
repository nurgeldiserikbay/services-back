-- Browser sessions must be bound to exactly the privileged admin session
-- that authorized their creation. A revoked/expired parent can no longer
-- authorize an otherwise unrevoked child browser session.
ALTER TABLE "platform_admin_appeal_browser_sessions"
  ADD COLUMN "admin_session_id" UUID NOT NULL;
CREATE INDEX "platform_admin_appeal_browser_sessions_admin_session_id_expires_at_idx"
 ON "platform_admin_appeal_browser_sessions"("admin_session_id","expires_at");
ALTER TABLE "platform_admin_appeal_browser_sessions"
 ADD CONSTRAINT "platform_admin_appeal_browser_sessions_admin_session_id_fkey"
 FOREIGN KEY ("admin_session_id") REFERENCES "platform_admin_sessions"("id")
 ON DELETE RESTRICT ON UPDATE CASCADE;
