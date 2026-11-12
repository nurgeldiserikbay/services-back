-- Compatibility repair: initial migrations already create some of these checks.
-- NOTE: environments that applied the old file must reconcile Prisma checksum history before deployment.
DO $checks$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public."platform_admin_staff"'::regclass AND conname='platform_admin_staff_role_check') THEN
    ALTER TABLE "platform_admin_staff" ADD CONSTRAINT "platform_admin_staff_role_check" CHECK ("role" IN ('owner','admin','operator','auditor'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public."platform_moderation_cases"'::regclass AND conname='platform_moderation_cases_subject_kind_check') THEN
    ALTER TABLE "platform_moderation_cases" ADD CONSTRAINT "platform_moderation_cases_subject_kind_check" CHECK ("subject_kind" IN ('professional','organization','review','affiliation'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public."platform_moderation_cases"'::regclass AND conname='platform_moderation_cases_state_check') THEN
    ALTER TABLE "platform_moderation_cases" ADD CONSTRAINT "platform_moderation_cases_state_check" CHECK ("state" IN ('triage','in_review','decision','appeal','closed'));
  END IF;
END
$checks$;
