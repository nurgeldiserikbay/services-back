-- Fail closed at the database boundary for privileged roles and moderation state.
-- Forward-only migration: never modify already-applied migration checksums.
ALTER TABLE "platform_admin_staff"
  ADD CONSTRAINT "platform_admin_staff_role_check"
  CHECK ("role" IN ('owner','admin','operator','auditor'));
ALTER TABLE "platform_moderation_cases"
  ADD CONSTRAINT "platform_moderation_cases_subject_kind_check"
  CHECK ("subject_kind" IN ('professional','organization','review','affiliation'));
ALTER TABLE "platform_moderation_cases"
  ADD CONSTRAINT "platform_moderation_cases_state_check"
  CHECK ("state" IN ('triage','in_review','decision','appeal','closed'));
