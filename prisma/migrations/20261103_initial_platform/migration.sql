-- GENERATED BASELINE FROM REVIEWED PRISMA SCHEMA; REVIEW BEFORE PRODUCTION.
-- CreateEnum
CREATE TYPE "AuthChannel" AS ENUM ('EMAIL', 'SMS');

-- CreateEnum
CREATE TYPE "AccountAuthPurpose" AS ENUM ('SIGN_IN', 'SIGN_UP');

-- CreateEnum
CREATE TYPE "GuestCapabilityScope" AS ENUM ('CREATE_REQUEST', 'READ_CANCEL', 'MANAGE_SCHEDULE');

-- CreateEnum
CREATE TYPE "GuestChallengePurpose" AS ENUM ('CREATE_REQUEST', 'RECOVER_REQUEST', 'MANAGE_SCHEDULE');

-- CreateEnum
CREATE TYPE "ConsentKind" AS ENUM ('TERMS', 'PRIVACY');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'DELETED');

-- CreateEnum
CREATE TYPE "ProfileStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'PAUSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "OrganizationStatus" AS ENUM ('DRAFT', 'ACTIVE', 'SUSPENDED', 'CLOSED');

-- CreateEnum
CREATE TYPE "MemberRole" AS ENUM ('OWNER', 'ADMIN', 'OPERATOR', 'AUDITOR');

-- CreateEnum
CREATE TYPE "AffiliationStatus" AS ENUM ('INVITED', 'ACTIVE', 'DECLINED', 'ENDED');

-- CreateEnum
CREATE TYPE "AssignmentStatus" AS ENUM ('PROPOSED', 'ACCEPTED', 'REVOKED');

-- CreateEnum
CREATE TYPE "OfferStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'PAUSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "WorkContext" AS ENUM ('PERSONAL', 'ORGANIZATION');

-- CreateEnum
CREATE TYPE "AvailabilityVisibility" AS ENUM ('HIDDEN', 'BUSY_ONLY', 'FREE_SLOTS');

-- CreateEnum
CREATE TYPE "RequestSourceContext" AS ENUM ('PERSONAL', 'ORGANIZATION');

-- CreateEnum
CREATE TYPE "RequestStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'CANCELLED_BY_CUSTOMER', 'CANCELLED_BY_PROVIDER', 'CANCELLED_MUTUAL', 'COMPLETED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "CancellationActor" AS ENUM ('CUSTOMER', 'SELLER', 'SYSTEM');

-- CreateEnum
CREATE TYPE "ReliabilitySubject" AS ENUM ('CUSTOMER', 'PROFESSIONAL', 'ORGANIZATION');

-- CreateEnum
CREATE TYPE "ReliabilityEventStatus" AS ENUM ('PROPOSED', 'EFFECTIVE', 'SUPPRESSED', 'APPEALED', 'REVERSED');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'SENT', 'DELIVERED', 'FAILED');

-- CreateEnum
CREATE TYPE "ExperienceStatus" AS ENUM ('UNVERIFIED', 'CONFIRMED', 'DISPUTED');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('SUBMITTED', 'PUBLISHED', 'UNDER_REVIEW', 'HIDDEN', 'REMOVED');

-- CreateEnum
CREATE TYPE "SavedTargetKind" AS ENUM ('PROFESSIONAL', 'ORGANIZATION', 'LOCATION', 'OFFER');

-- CreateEnum
CREATE TYPE "ScheduleProposalStatus" AS ENUM ('PROPOSED', 'CONFIRMED', 'DECLINED', 'SUPERSEDED', 'CLOSED');

-- CreateEnum
CREATE TYPE "ScheduleProposalActor" AS ENUM ('CUSTOMER', 'SELLER');

-- CreateEnum
CREATE TYPE "NoShowClaimStatus" AS ENUM ('FILED', 'AWAITING_CUSTOMER', 'DISPUTED', 'UNCONTESTED', 'UNDER_REVIEW', 'CONFIRMED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "PublicationState" AS ENUM ('READY', 'STALE', 'REVOKED');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" VARCHAR(320),
    "phone" VARCHAR(40),
    "password_hash" TEXT,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "family_id" UUID NOT NULL,
    "last_used_at" TIMESTAMPTZ(3),
    "rotated_at" TIMESTAMPTZ(3),
    "device_label" VARCHAR(120),
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_auth_challenges" (
    "id" UUID NOT NULL,
    "channel" "AuthChannel" NOT NULL,
    "purpose" "AccountAuthPurpose" NOT NULL,
    "contact_digest" VARCHAR(128) NOT NULL,
    "contact_cipher" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "consumed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "account_auth_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_consents" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "kind" "ConsentKind" NOT NULL,
    "version" VARCHAR(40) NOT NULL,
    "accepted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "account_consents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "persons" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "display_name" VARCHAR(160),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "persons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "countries" (
    "id" UUID NOT NULL,
    "iso2" CHAR(2) NOT NULL,
    "name" VARCHAR(140) NOT NULL,

    CONSTRAINT "countries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "geo_areas" (
    "id" UUID NOT NULL,
    "country_id" UUID NOT NULL,
    "code" VARCHAR(32),
    "name" VARCHAR(140) NOT NULL,

    CONSTRAINT "geo_areas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cities" (
    "id" UUID NOT NULL,
    "country_id" UUID NOT NULL,
    "area_id" UUID,
    "name" VARCHAR(140) NOT NULL,
    "timezone" VARCHAR(64) NOT NULL,

    CONSTRAINT "cities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "professions" (
    "id" UUID NOT NULL,
    "code" VARCHAR(96) NOT NULL,
    "name" VARCHAR(160) NOT NULL,

    CONSTRAINT "professions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_definitions" (
    "id" UUID NOT NULL,
    "code" VARCHAR(96) NOT NULL,
    "name" VARCHAR(160) NOT NULL,

    CONSTRAINT "service_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profession_services" (
    "profession_id" UUID NOT NULL,
    "service_id" UUID NOT NULL,

    CONSTRAINT "profession_services_pkey" PRIMARY KEY ("profession_id","service_id")
);

-- CreateTable
CREATE TABLE "professional_profiles" (
    "id" UUID NOT NULL,
    "person_id" UUID NOT NULL,
    "profession_id" UUID NOT NULL,
    "slug" VARCHAR(160) NOT NULL,
    "status" "ProfileStatus" NOT NULL DEFAULT 'DRAFT',
    "title" VARCHAR(180),

    CONSTRAINT "professional_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organizations" (
    "id" UUID NOT NULL,
    "owner_person_id" UUID NOT NULL,
    "slug" VARCHAR(160) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "status" "OrganizationStatus" NOT NULL DEFAULT 'DRAFT',

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_members" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "MemberRole" NOT NULL,
    "scope" JSONB,
    "revoked_at" TIMESTAMPTZ(3),

    CONSTRAINT "organization_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "locations" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "city_id" UUID NOT NULL,
    "name" VARCHAR(180) NOT NULL,
    "public_address" VARCHAR(500),
    "timezone" VARCHAR(64) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "affiliations" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "professional_id" UUID NOT NULL,
    "status" "AffiliationStatus" NOT NULL DEFAULT 'INVITED',
    "specialist_approved_at" TIMESTAMPTZ(3),
    "company_approved_at" TIMESTAMPTZ(3),
    "ended_at" TIMESTAMPTZ(3),

    CONSTRAINT "affiliations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_professional_views" (
    "id" UUID NOT NULL,
    "affiliation_id" UUID NOT NULL,
    "professional_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "master_allowed_fields" JSONB NOT NULL,
    "company_selected_fields" JSONB NOT NULL,
    "company_content" JSONB,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "published_at" TIMESTAMPTZ(3),

    CONSTRAINT "company_professional_views_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_offers" (
    "id" UUID NOT NULL,
    "definition_id" UUID NOT NULL,
    "professional_id" UUID,
    "organization_id" UUID,
    "location_id" UUID,
    "city_id" UUID,
    "title" VARCHAR(200) NOT NULL,
    "status" "OfferStatus" NOT NULL DEFAULT 'DRAFT',
    "delivery_mode" VARCHAR(24) NOT NULL,
    "contacts" JSONB NOT NULL,
    "availability" "AvailabilityVisibility" NOT NULL DEFAULT 'HIDDEN',
    "price_label" VARCHAR(160),
    "currency" CHAR(3),
    "revision" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "service_offers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_assignments" (
    "id" UUID NOT NULL,
    "offer_id" UUID NOT NULL,
    "professional_id" UUID NOT NULL,
    "status" "AssignmentStatus" NOT NULL DEFAULT 'PROPOSED',
    "approved_at" TIMESTAMPTZ(3),

    CONSTRAINT "service_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guest_contacts" (
    "id" UUID NOT NULL,
    "channel" VARCHAR(12) NOT NULL,
    "encrypted_value" TEXT NOT NULL,
    "digest" VARCHAR(128) NOT NULL,
    "verified_at" TIMESTAMPTZ(3),
    "expires_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "guest_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guest_challenges" (
    "id" UUID NOT NULL,
    "guest_contact_id" UUID NOT NULL,
    "code_hash" TEXT NOT NULL,
    "purpose" "GuestChallengePurpose" NOT NULL DEFAULT 'CREATE_REQUEST',
    "consumed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "guest_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guest_capabilities" (
    "id" UUID NOT NULL,
    "guest_contact_id" UUID NOT NULL,
    "request_id" UUID,
    "scope" "GuestCapabilityScope" NOT NULL,
    "token_hash" VARCHAR(128) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "consumed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "guest_capabilities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cancellation_policies" (
    "offer_id" UUID NOT NULL,
    "free_cancel_before_min" INTEGER NOT NULL DEFAULT 120,
    "revision" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "cancellation_policies_pkey" PRIMARY KEY ("offer_id")
);

-- CreateTable
CREATE TABLE "service_requests" (
    "id" UUID NOT NULL,
    "offer_id" UUID NOT NULL,
    "customer_person_id" UUID,
    "guest_contact_id" UUID,
    "source_context" "RequestSourceContext" NOT NULL,
    "seller_professional_id" UUID,
    "seller_organization_id" UUID,
    "performer_professional_id" UUID,
    "status" "RequestStatus" NOT NULL DEFAULT 'PENDING',
    "scheduled_start_at" TIMESTAMPTZ(3),
    "scheduled_end_at" TIMESTAMPTZ(3),
    "timezone" VARCHAR(64),
    "note" VARCHAR(1000),
    "version" INTEGER NOT NULL DEFAULT 1,
    "accepted_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "customer_penalty_suspended" BOOLEAN NOT NULL DEFAULT false,
    "schedule_reconciliation_required" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "service_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_request_events" (
    "id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "kind" VARCHAR(64) NOT NULL,
    "actor_id" UUID,
    "detail" JSONB,
    "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_request_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cancellation_snapshots" (
    "request_id" UUID NOT NULL,
    "policy_revision" INTEGER NOT NULL,
    "scheduled_start_at" TIMESTAMPTZ(3) NOT NULL,
    "free_cancel_before_min" INTEGER NOT NULL,
    "free_cancel_until" TIMESTAMPTZ(3) NOT NULL,
    "accepted_at" TIMESTAMPTZ(3) NOT NULL,
    "timezone" VARCHAR(64) NOT NULL,

    CONSTRAINT "cancellation_snapshots_pkey" PRIMARY KEY ("request_id")
);

-- CreateTable
CREATE TABLE "cancellation_events" (
    "id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "actor" "CancellationActor" NOT NULL,
    "reason_code" VARCHAR(64),
    "is_late" BOOLEAN NOT NULL DEFAULT false,
    "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cancellation_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "availability_allocations" (
    "id" UUID NOT NULL,
    "professional_id" UUID NOT NULL,
    "organization_id" UUID,
    "context" "WorkContext" NOT NULL,
    "timezone" VARCHAR(64) NOT NULL,
    "recurring_hours" JSONB NOT NULL,
    "exceptions" JSONB,
    "master_approved" BOOLEAN NOT NULL DEFAULT false,
    "company_approved" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "availability_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "busy_blocks" (
    "id" UUID NOT NULL,
    "professional_id" UUID NOT NULL,
    "request_id" UUID,
    "organization_id" UUID,
    "start_at" TIMESTAMPTZ(3) NOT NULL,
    "end_at" TIMESTAMPTZ(3) NOT NULL,
    "context" "WorkContext" NOT NULL,
    "private_reason" VARCHAR(64),

    CONSTRAINT "busy_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "domain_outbox_events" (
    "id" UUID NOT NULL,
    "topic" VARCHAR(96) NOT NULL,
    "subject_kind" VARCHAR(50) NOT NULL,
    "subject_id" UUID NOT NULL,
    "safe_payload" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(3),

    CONSTRAINT "domain_outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_intents" (
    "id" UUID NOT NULL,
    "cancellation_id" UUID,
    "domain_event_id" UUID NOT NULL,
    "recipient_person_id" UUID,
    "recipient_org_id" UUID,
    "guest_contact_id" UUID,
    "audience" VARCHAR(16) NOT NULL,
    "channel" VARCHAR(12) NOT NULL,
    "state" "NotificationStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(3),
    "dedupe_key" VARCHAR(180) NOT NULL,

    CONSTRAINT "notification_intents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_deliveries" (
    "id" UUID NOT NULL,
    "intent_id" UUID NOT NULL,
    "channel" VARCHAR(20) NOT NULL,
    "provider_ref" VARCHAR(160),
    "state" "NotificationStatus" NOT NULL DEFAULT 'PENDING',
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(3),
    "delivered_at" TIMESTAMPTZ(3),

    CONSTRAINT "notification_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reliability_events" (
    "id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "subject" "ReliabilitySubject" NOT NULL,
    "customer_person_id" UUID,
    "professional_id" UUID,
    "organization_id" UUID,
    "reason" VARCHAR(64) NOT NULL,
    "weight" DECIMAL(5,2) NOT NULL,
    "status" "ReliabilityEventStatus" NOT NULL DEFAULT 'PROPOSED',
    "formula_version" VARCHAR(32) NOT NULL,
    "dedupe_key" VARCHAR(180) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reliability_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_experiences" (
    "id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "status" "ExperienceStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "confirmed_at" TIMESTAMPTZ(3),

    CONSTRAINT "service_experiences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reviews" (
    "id" UUID NOT NULL,
    "experience_id" UUID NOT NULL,
    "author_person_id" UUID,
    "professional_id" UUID,
    "organization_id" UUID,
    "location_id" UUID,
    "rating" INTEGER NOT NULL,
    "comment" VARCHAR(3000),
    "verified_experience_snapshot" BOOLEAN NOT NULL DEFAULT false,
    "anonymized_at" TIMESTAMPTZ(3),
    "status" "ReviewStatus" NOT NULL DEFAULT 'SUBMITTED',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saved_items" (
    "id" UUID NOT NULL,
    "person_id" UUID NOT NULL,
    "target_kind" "SavedTargetKind" NOT NULL,
    "target_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "saved_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_records" (
    "id" UUID NOT NULL,
    "actor_scope" VARCHAR(128) NOT NULL,
    "method" VARCHAR(12) NOT NULL,
    "route" VARCHAR(180) NOT NULL,
    "key" VARCHAR(128) NOT NULL,
    "request_hash" VARCHAR(128) NOT NULL,
    "state" VARCHAR(24) NOT NULL DEFAULT 'PROCESSING',
    "response_status" INTEGER,
    "response_body" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schedule_proposals" (
    "id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "revision" INTEGER NOT NULL,
    "status" "ScheduleProposalStatus" NOT NULL DEFAULT 'PROPOSED',
    "initiator" "ScheduleProposalActor" NOT NULL,
    "proposed_start_at" TIMESTAMPTZ(3) NOT NULL,
    "proposed_end_at" TIMESTAMPTZ(3) NOT NULL,
    "timezone" VARCHAR(64) NOT NULL,
    "local_start_at" VARCHAR(32),
    "utc_offset_seconds" INTEGER,
    "tzdb_version" VARCHAR(64),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ(3),
    "resolved_by" "ScheduleProposalActor",

    CONSTRAINT "schedule_proposals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cancellation_snapshot_revisions" (
    "id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "schedule_revision" INTEGER NOT NULL,
    "policy_revision" INTEGER NOT NULL,
    "scheduled_start_at" TIMESTAMPTZ(3) NOT NULL,
    "free_cancel_before_min" INTEGER NOT NULL,
    "free_cancel_until" TIMESTAMPTZ(3) NOT NULL,
    "agreed_at" TIMESTAMPTZ(3) NOT NULL,
    "timezone" VARCHAR(64) NOT NULL,
    "local_start_at" VARCHAR(32),
    "utc_offset_seconds" INTEGER,
    "tzdb_version" VARCHAR(64),

    CONSTRAINT "cancellation_snapshot_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "published_company_professional_views" (
    "view_id" UUID NOT NULL,
    "source_revision" INTEGER NOT NULL,
    "state" "PublicationState" NOT NULL DEFAULT 'STALE',
    "public_payload" JSONB,
    "generated_at" TIMESTAMPTZ(3),

    CONSTRAINT "published_company_professional_views_pkey" PRIMARY KEY ("view_id")
);

-- CreateTable
CREATE TABLE "no_show_claims" (
    "id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "schedule_revision" INTEGER NOT NULL,
    "status" "NoShowClaimStatus" NOT NULL DEFAULT 'FILED',
    "seller_reported_at" TIMESTAMPTZ(3) NOT NULL,
    "customer_responded_at" TIMESTAMPTZ(3),
    "reviewed_at" TIMESTAMPTZ(3),
    "reviewed_by_user_id" UUID,
    "decision_reason_code" VARCHAR(64),
    "evidence_reference" VARCHAR(256),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "no_show_claims_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guest_recovery_sessions" (
    "id" UUID NOT NULL,
    "guest_contact_id" UUID NOT NULL,
    "token_hash" VARCHAR(128) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "guest_recovery_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");

-- CreateIndex
CREATE INDEX "sessions_user_id_expires_at_idx" ON "sessions"("user_id", "expires_at");

-- CreateIndex
CREATE INDEX "sessions_family_id_revoked_at_idx" ON "sessions"("family_id", "revoked_at");

-- CreateIndex
CREATE INDEX "account_auth_challenges_contact_digest_created_at_idx" ON "account_auth_challenges"("contact_digest", "created_at");

-- CreateIndex
CREATE INDEX "account_auth_challenges_expires_at_idx" ON "account_auth_challenges"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "account_consents_user_id_kind_version_key" ON "account_consents"("user_id", "kind", "version");

-- CreateIndex
CREATE UNIQUE INDEX "persons_user_id_key" ON "persons"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "countries_iso2_key" ON "countries"("iso2");

-- CreateIndex
CREATE UNIQUE INDEX "geo_areas_country_id_code_key" ON "geo_areas"("country_id", "code");

-- CreateIndex
CREATE INDEX "cities_country_id_area_id_name_idx" ON "cities"("country_id", "area_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "professions_code_key" ON "professions"("code");

-- CreateIndex
CREATE UNIQUE INDEX "service_definitions_code_key" ON "service_definitions"("code");

-- CreateIndex
CREATE UNIQUE INDEX "professional_profiles_slug_key" ON "professional_profiles"("slug");

-- CreateIndex
CREATE INDEX "professional_profiles_status_profession_id_idx" ON "professional_profiles"("status", "profession_id");

-- CreateIndex
CREATE UNIQUE INDEX "professional_profiles_person_id_profession_id_key" ON "professional_profiles"("person_id", "profession_id");

-- CreateIndex
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");

-- CreateIndex
CREATE INDEX "organization_members_organization_id_user_id_revoked_at_idx" ON "organization_members"("organization_id", "user_id", "revoked_at");

-- CreateIndex
CREATE INDEX "locations_city_id_active_idx" ON "locations"("city_id", "active");

-- CreateIndex
CREATE INDEX "affiliations_organization_id_status_idx" ON "affiliations"("organization_id", "status");

-- CreateIndex
CREATE INDEX "affiliations_professional_id_status_idx" ON "affiliations"("professional_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "company_professional_views_affiliation_id_key" ON "company_professional_views"("affiliation_id");

-- CreateIndex
CREATE INDEX "company_professional_views_organization_id_published_at_idx" ON "company_professional_views"("organization_id", "published_at");

-- CreateIndex
CREATE INDEX "service_offers_city_id_status_definition_id_idx" ON "service_offers"("city_id", "status", "definition_id");

-- CreateIndex
CREATE INDEX "service_offers_professional_id_status_idx" ON "service_offers"("professional_id", "status");

-- CreateIndex
CREATE INDEX "service_offers_organization_id_status_idx" ON "service_offers"("organization_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "service_assignments_offer_id_professional_id_key" ON "service_assignments"("offer_id", "professional_id");

-- CreateIndex
CREATE INDEX "guest_contacts_digest_expires_at_idx" ON "guest_contacts"("digest", "expires_at");

-- CreateIndex
CREATE INDEX "guest_challenges_guest_contact_id_expires_at_idx" ON "guest_challenges"("guest_contact_id", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "guest_capabilities_token_hash_key" ON "guest_capabilities"("token_hash");

-- CreateIndex
CREATE INDEX "guest_capabilities_guest_contact_id_expires_at_idx" ON "guest_capabilities"("guest_contact_id", "expires_at");

-- CreateIndex
CREATE INDEX "guest_capabilities_request_id_scope_idx" ON "guest_capabilities"("request_id", "scope");

-- CreateIndex
CREATE INDEX "service_requests_customer_person_id_created_at_idx" ON "service_requests"("customer_person_id", "created_at");

-- CreateIndex
CREATE INDEX "service_requests_seller_organization_id_status_created_at_idx" ON "service_requests"("seller_organization_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "service_requests_seller_professional_id_status_created_at_idx" ON "service_requests"("seller_professional_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "service_requests_offer_id_scheduled_start_at_idx" ON "service_requests"("offer_id", "scheduled_start_at");

-- CreateIndex
CREATE INDEX "service_request_events_request_id_at_idx" ON "service_request_events"("request_id", "at");

-- CreateIndex
CREATE UNIQUE INDEX "cancellation_events_request_id_key" ON "cancellation_events"("request_id");

-- CreateIndex
CREATE INDEX "availability_allocations_professional_id_context_idx" ON "availability_allocations"("professional_id", "context");

-- CreateIndex
CREATE INDEX "busy_blocks_professional_id_start_at_end_at_idx" ON "busy_blocks"("professional_id", "start_at", "end_at");

-- CreateIndex
CREATE INDEX "domain_outbox_events_processed_at_created_at_idx" ON "domain_outbox_events"("processed_at", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "notification_intents_dedupe_key_key" ON "notification_intents"("dedupe_key");

-- CreateIndex
CREATE INDEX "notification_intents_state_next_attempt_at_idx" ON "notification_intents"("state", "next_attempt_at");

-- CreateIndex
CREATE INDEX "notification_intents_domain_event_id_audience_idx" ON "notification_intents"("domain_event_id", "audience");

-- CreateIndex
CREATE INDEX "notification_deliveries_state_next_attempt_at_idx" ON "notification_deliveries"("state", "next_attempt_at");

-- CreateIndex
CREATE UNIQUE INDEX "notification_deliveries_intent_id_channel_key" ON "notification_deliveries"("intent_id", "channel");

-- CreateIndex
CREATE UNIQUE INDEX "reliability_events_dedupe_key_key" ON "reliability_events"("dedupe_key");

-- CreateIndex
CREATE INDEX "reliability_events_customer_person_id_created_at_idx" ON "reliability_events"("customer_person_id", "created_at");

-- CreateIndex
CREATE INDEX "reliability_events_professional_id_created_at_idx" ON "reliability_events"("professional_id", "created_at");

-- CreateIndex
CREATE INDEX "reliability_events_organization_id_created_at_idx" ON "reliability_events"("organization_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "service_experiences_request_id_key" ON "service_experiences"("request_id");

-- CreateIndex
CREATE INDEX "reviews_status_created_at_idx" ON "reviews"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "reviews_experience_id_professional_id_key" ON "reviews"("experience_id", "professional_id");

-- CreateIndex
CREATE UNIQUE INDEX "reviews_experience_id_organization_id_key" ON "reviews"("experience_id", "organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "reviews_experience_id_location_id_key" ON "reviews"("experience_id", "location_id");

-- CreateIndex
CREATE UNIQUE INDEX "saved_items_person_id_target_kind_target_id_key" ON "saved_items"("person_id", "target_kind", "target_id");

-- CreateIndex
CREATE INDEX "idempotency_records_expires_at_idx" ON "idempotency_records"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_records_actor_scope_method_route_key_key" ON "idempotency_records"("actor_scope", "method", "route", "key");

-- CreateIndex
CREATE INDEX "schedule_proposals_request_id_status_created_at_idx" ON "schedule_proposals"("request_id", "status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "schedule_proposals_request_id_revision_key" ON "schedule_proposals"("request_id", "revision");

-- CreateIndex
CREATE INDEX "cancellation_snapshot_revisions_request_id_agreed_at_idx" ON "cancellation_snapshot_revisions"("request_id", "agreed_at");

-- CreateIndex
CREATE UNIQUE INDEX "cancellation_snapshot_revisions_request_id_schedule_revisio_key" ON "cancellation_snapshot_revisions"("request_id", "schedule_revision");

-- CreateIndex
CREATE INDEX "published_company_professional_views_state_source_revision_idx" ON "published_company_professional_views"("state", "source_revision");

-- CreateIndex
CREATE INDEX "no_show_claims_status_created_at_idx" ON "no_show_claims"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "no_show_claims_request_id_schedule_revision_key" ON "no_show_claims"("request_id", "schedule_revision");

-- CreateIndex
CREATE UNIQUE INDEX "guest_recovery_sessions_token_hash_key" ON "guest_recovery_sessions"("token_hash");

-- CreateIndex
CREATE INDEX "guest_recovery_sessions_guest_contact_id_expires_at_idx" ON "guest_recovery_sessions"("guest_contact_id", "expires_at");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_consents" ADD CONSTRAINT "account_consents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "persons" ADD CONSTRAINT "persons_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "geo_areas" ADD CONSTRAINT "geo_areas_country_id_fkey" FOREIGN KEY ("country_id") REFERENCES "countries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cities" ADD CONSTRAINT "cities_country_id_fkey" FOREIGN KEY ("country_id") REFERENCES "countries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cities" ADD CONSTRAINT "cities_area_id_fkey" FOREIGN KEY ("area_id") REFERENCES "geo_areas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profession_services" ADD CONSTRAINT "profession_services_profession_id_fkey" FOREIGN KEY ("profession_id") REFERENCES "professions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profession_services" ADD CONSTRAINT "profession_services_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "service_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "professional_profiles" ADD CONSTRAINT "professional_profiles_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "persons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "professional_profiles" ADD CONSTRAINT "professional_profiles_profession_id_fkey" FOREIGN KEY ("profession_id") REFERENCES "professions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_owner_person_id_fkey" FOREIGN KEY ("owner_person_id") REFERENCES "persons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "locations" ADD CONSTRAINT "locations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "locations" ADD CONSTRAINT "locations_city_id_fkey" FOREIGN KEY ("city_id") REFERENCES "cities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "affiliations" ADD CONSTRAINT "affiliations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "affiliations" ADD CONSTRAINT "affiliations_professional_id_fkey" FOREIGN KEY ("professional_id") REFERENCES "professional_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_professional_views" ADD CONSTRAINT "company_professional_views_affiliation_id_fkey" FOREIGN KEY ("affiliation_id") REFERENCES "affiliations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_professional_views" ADD CONSTRAINT "company_professional_views_professional_id_fkey" FOREIGN KEY ("professional_id") REFERENCES "professional_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_professional_views" ADD CONSTRAINT "company_professional_views_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_offers" ADD CONSTRAINT "service_offers_definition_id_fkey" FOREIGN KEY ("definition_id") REFERENCES "service_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_offers" ADD CONSTRAINT "service_offers_professional_id_fkey" FOREIGN KEY ("professional_id") REFERENCES "professional_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_offers" ADD CONSTRAINT "service_offers_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_offers" ADD CONSTRAINT "service_offers_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_offers" ADD CONSTRAINT "service_offers_city_id_fkey" FOREIGN KEY ("city_id") REFERENCES "cities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_assignments" ADD CONSTRAINT "service_assignments_offer_id_fkey" FOREIGN KEY ("offer_id") REFERENCES "service_offers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_assignments" ADD CONSTRAINT "service_assignments_professional_id_fkey" FOREIGN KEY ("professional_id") REFERENCES "professional_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guest_challenges" ADD CONSTRAINT "guest_challenges_guest_contact_id_fkey" FOREIGN KEY ("guest_contact_id") REFERENCES "guest_contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guest_capabilities" ADD CONSTRAINT "guest_capabilities_guest_contact_id_fkey" FOREIGN KEY ("guest_contact_id") REFERENCES "guest_contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guest_capabilities" ADD CONSTRAINT "guest_capabilities_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "service_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cancellation_policies" ADD CONSTRAINT "cancellation_policies_offer_id_fkey" FOREIGN KEY ("offer_id") REFERENCES "service_offers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_offer_id_fkey" FOREIGN KEY ("offer_id") REFERENCES "service_offers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_customer_person_id_fkey" FOREIGN KEY ("customer_person_id") REFERENCES "persons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_guest_contact_id_fkey" FOREIGN KEY ("guest_contact_id") REFERENCES "guest_contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_seller_professional_id_fkey" FOREIGN KEY ("seller_professional_id") REFERENCES "professional_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_seller_organization_id_fkey" FOREIGN KEY ("seller_organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_performer_professional_id_fkey" FOREIGN KEY ("performer_professional_id") REFERENCES "professional_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_request_events" ADD CONSTRAINT "service_request_events_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "service_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cancellation_snapshots" ADD CONSTRAINT "cancellation_snapshots_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "service_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cancellation_events" ADD CONSTRAINT "cancellation_events_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "service_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "availability_allocations" ADD CONSTRAINT "availability_allocations_professional_id_fkey" FOREIGN KEY ("professional_id") REFERENCES "professional_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "availability_allocations" ADD CONSTRAINT "availability_allocations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "busy_blocks" ADD CONSTRAINT "busy_blocks_professional_id_fkey" FOREIGN KEY ("professional_id") REFERENCES "professional_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "busy_blocks" ADD CONSTRAINT "busy_blocks_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "service_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "busy_blocks" ADD CONSTRAINT "busy_blocks_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_intents" ADD CONSTRAINT "notification_intents_cancellation_id_fkey" FOREIGN KEY ("cancellation_id") REFERENCES "cancellation_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_intents" ADD CONSTRAINT "notification_intents_domain_event_id_fkey" FOREIGN KEY ("domain_event_id") REFERENCES "domain_outbox_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_intents" ADD CONSTRAINT "notification_intents_recipient_org_id_fkey" FOREIGN KEY ("recipient_org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_intents" ADD CONSTRAINT "notification_intents_recipient_person_id_fkey" FOREIGN KEY ("recipient_person_id") REFERENCES "persons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_intents" ADD CONSTRAINT "notification_intents_guest_contact_id_fkey" FOREIGN KEY ("guest_contact_id") REFERENCES "guest_contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_intent_id_fkey" FOREIGN KEY ("intent_id") REFERENCES "notification_intents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reliability_events" ADD CONSTRAINT "reliability_events_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "service_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reliability_events" ADD CONSTRAINT "reliability_events_customer_person_id_fkey" FOREIGN KEY ("customer_person_id") REFERENCES "persons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reliability_events" ADD CONSTRAINT "reliability_events_professional_id_fkey" FOREIGN KEY ("professional_id") REFERENCES "professional_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reliability_events" ADD CONSTRAINT "reliability_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_experiences" ADD CONSTRAINT "service_experiences_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "service_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_experiences" ADD CONSTRAINT "service_experiences_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "persons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_experience_id_fkey" FOREIGN KEY ("experience_id") REFERENCES "service_experiences"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_author_person_id_fkey" FOREIGN KEY ("author_person_id") REFERENCES "persons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_professional_id_fkey" FOREIGN KEY ("professional_id") REFERENCES "professional_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_items" ADD CONSTRAINT "saved_items_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "persons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_proposals" ADD CONSTRAINT "schedule_proposals_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "service_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cancellation_snapshot_revisions" ADD CONSTRAINT "cancellation_snapshot_revisions_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "service_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "published_company_professional_views" ADD CONSTRAINT "published_company_professional_views_view_id_fkey" FOREIGN KEY ("view_id") REFERENCES "company_professional_views"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "no_show_claims" ADD CONSTRAINT "no_show_claims_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "service_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guest_recovery_sessions" ADD CONSTRAINT "guest_recovery_sessions_guest_contact_id_fkey" FOREIGN KEY ("guest_contact_id") REFERENCES "guest_contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Custom transactional invariants (G0 contracts).
-- Services · PostgreSQL reference invariants, migration REVIEW REQUIRED.
-- Apply AFTER Prisma-generated baseline migrations; do not execute blindly.
-- This file is a design contract, not evidence of an applied migration.
-- Names match @@map/@map in contracts/prisma/schema.prisma.
--
-- 1. Each offer and request has EXACTLY ONE seller.
ALTER TABLE service_offers
  ADD CONSTRAINT service_offers_seller_xor
  CHECK ((professional_id IS NOT NULL) <> (organization_id IS NOT NULL));
ALTER TABLE service_requests
  ADD CONSTRAINT service_requests_seller_xor
  CHECK ((seller_professional_id IS NOT NULL) <> (seller_organization_id IS NOT NULL));
ALTER TABLE service_requests
  ADD CONSTRAINT service_requests_customer_xor
  CHECK ((customer_person_id IS NOT NULL) <> (guest_contact_id IS NOT NULL));
ALTER TABLE service_requests
  ADD CONSTRAINT service_requests_time_valid
  CHECK (scheduled_start_at IS NULL OR scheduled_end_at IS NULL OR scheduled_end_at > scheduled_start_at);
ALTER TABLE service_offers
  ADD CONSTRAINT service_offers_delivery_mode_valid
  CHECK (delivery_mode IN ('at_location','at_customer','online','hybrid'));

-- Business-context allocations require explicit matching organization, no leak into personal.
ALTER TABLE availability_allocations
  ADD CONSTRAINT allocation_context_owner
  CHECK ((context = 'PERSONAL' AND organization_id IS NULL)
     OR (context = 'ORGANIZATION' AND organization_id IS NOT NULL));
ALTER TABLE busy_blocks
  ADD CONSTRAINT busy_block_context_owner
  CHECK ((context = 'PERSONAL' AND organization_id IS NULL)
     OR (context = 'ORGANIZATION' AND organization_id IS NOT NULL));
-- ServiceRequest.performer_professional_id must be validated by the domain layer:
-- for corporate offers the chosen performer needs an accepted ServiceAssignment.
-- Seller and performer are distinct, and changing the performer must not change seller.

-- 2. Reference semantics and bounded cancellation policy.
ALTER TABLE cancellation_policies
  ADD CONSTRAINT cancellation_policies_window
  CHECK (free_cancel_before_min BETWEEN 0 AND 10080 AND revision > 0);
ALTER TABLE cancellation_snapshots
  ADD CONSTRAINT cancellation_snapshots_window
  CHECK (free_cancel_before_min BETWEEN 0 AND 10080
         AND free_cancel_until <= scheduled_start_at
         AND accepted_at <= scheduled_start_at);
ALTER TABLE busy_blocks
  ADD CONSTRAINT busy_blocks_time_valid CHECK (end_at > start_at);
ALTER TABLE reviews
  ADD CONSTRAINT reviews_target_xor
  CHECK (num_nonnulls(professional_id,organization_id,location_id) = 1);
ALTER TABLE reviews
  ADD CONSTRAINT reviews_rating_range CHECK (rating BETWEEN 1 AND 5);
ALTER TABLE reliability_events
  ADD CONSTRAINT reliability_subject_target_match
  CHECK ((subject::text = 'CUSTOMER' AND customer_person_id IS NOT NULL
          AND professional_id IS NULL AND organization_id IS NULL)
      OR (subject::text = 'PROFESSIONAL' AND professional_id IS NOT NULL
          AND customer_person_id IS NULL AND organization_id IS NULL)
      OR (subject::text = 'ORGANIZATION' AND organization_id IS NOT NULL
          AND professional_id IS NULL AND customer_person_id IS NULL));
ALTER TABLE reliability_events
  ADD CONSTRAINT reliability_weight_valid CHECK (weight >= 0);
ALTER TABLE notification_intents
  ADD CONSTRAINT notification_recipient_xor
  CHECK (num_nonnulls(recipient_person_id,recipient_org_id,guest_contact_id) = 1);
ALTER TABLE notification_intents
  ADD CONSTRAINT notification_audience
  CHECK (audience IN ('INITIATOR','COUNTERPARTY','SELLER','CLIENT'));

-- 3. Conditional uniqueness. An ended affiliation is preserved; only one ACTIVE.
CREATE UNIQUE INDEX IF NOT EXISTS active_affiliation_unique_pair
  ON affiliations (organization_id,professional_id) WHERE status = 'ACTIVE';
CREATE UNIQUE INDEX IF NOT EXISTS active_organization_member_unique
  ON organization_members (organization_id,user_id) WHERE revoked_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS cancellation_intent_unique_audience
  ON notification_intents (cancellation_id,audience);

-- 4. A person cannot be busy in two contexts simultaneously when the system knows the blocks.
-- Requires privileges for btree_gist extension in the chosen managed Postgres.
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE busy_blocks
  ADD CONSTRAINT no_overlapping_known_busy_blocks
  EXCLUDE USING gist (
    professional_id WITH =,
    tstzrange(start_at,end_at,'[)') WITH &&
  );

-- 5. Verify route ownership from the canonical ServiceOffer every time.
-- A request's seller and personal/company source cannot be substituted by HTTP client.
CREATE OR REPLACE FUNCTION enforce_request_seller() RETURNS trigger AS $$
DECLARE
  p UUID;
  o UUID;
BEGIN
  SELECT professional_id, organization_id INTO p,o
    FROM service_offers WHERE id=NEW.offer_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Unknown offer' USING ERRCODE='23503'; END IF;
  IF NEW.seller_professional_id IS DISTINCT FROM p
     OR NEW.seller_organization_id IS DISTINCT FROM o THEN
    RAISE EXCEPTION 'Seller must match offer' USING ERRCODE='23514';
  END IF;
  IF (NEW.source_context::text = 'PERSONAL' AND p IS NULL)
     OR (NEW.source_context::text = 'ORGANIZATION' AND o IS NULL) THEN
    RAISE EXCEPTION 'Incorrect source context' USING ERRCODE='23514';
  END IF;
  IF TG_OP='UPDATE' AND
     (NEW.offer_id IS DISTINCT FROM OLD.offer_id
       OR NEW.customer_person_id IS DISTINCT FROM OLD.customer_person_id
       OR NEW.guest_contact_id IS DISTINCT FROM OLD.guest_contact_id
       OR NEW.source_context IS DISTINCT FROM OLD.source_context
       OR NEW.seller_professional_id IS DISTINCT FROM OLD.seller_professional_id
       OR NEW.seller_organization_id IS DISTINCT FROM OLD.seller_organization_id) THEN
    RAISE EXCEPTION 'Request identity/seller is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER service_requests_seller_guard
  BEFORE INSERT OR UPDATE ON service_requests
  FOR EACH ROW EXECUTE FUNCTION enforce_request_seller();

-- Reject changing the seller of an offer with a recorded customer request.
CREATE OR REPLACE FUNCTION guard_offer_seller_change() RETURNS trigger AS $$
BEGIN
  IF (NEW.professional_id IS DISTINCT FROM OLD.professional_id
      OR NEW.organization_id IS DISTINCT FROM OLD.organization_id)
      AND EXISTS (SELECT 1 FROM service_requests WHERE offer_id=OLD.id) THEN
    RAISE EXCEPTION 'Cannot reassign seller of an offered service with requests'
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER service_offers_seller_guard
  BEFORE UPDATE OF professional_id,organization_id ON service_offers
  FOR EACH ROW EXECUTE FUNCTION guard_offer_seller_change();

-- Verify company projection belongs to EXACTLY the approved affiliation.
CREATE OR REPLACE FUNCTION enforce_company_view_link() RETURNS trigger AS $$
DECLARE
  a RECORD;
BEGIN
  SELECT organization_id,professional_id,status,specialist_approved_at,company_approved_at
    INTO a FROM affiliations WHERE id=NEW.affiliation_id FOR SHARE;
  IF NOT FOUND OR a.organization_id <> NEW.organization_id
     OR a.professional_id <> NEW.professional_id THEN
    RAISE EXCEPTION 'Company view does not match affiliation'
      USING ERRCODE='23514';
  END IF;
  IF NEW.published_at IS NOT NULL AND
     (a.status::text <> 'ACTIVE'
      OR a.specialist_approved_at IS NULL OR a.company_approved_at IS NULL) THEN
    RAISE EXCEPTION 'Cannot publish view without mutual approval'
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER company_views_affiliation_guard
  BEFORE INSERT OR UPDATE ON company_professional_views
  FOR EACH ROW EXECUTE FUNCTION enforce_company_view_link();

-- 6a. Account challenge and request-scoped guest capability guards.
ALTER TABLE account_auth_challenges
  ADD CONSTRAINT account_auth_challenge_attempts
  CHECK (attempts BETWEEN 0 AND 5 AND expires_at > created_at);
ALTER TABLE guest_capabilities
  ADD CONSTRAINT guest_capability_scope_request
  CHECK ((scope = 'CREATE_REQUEST' AND request_id IS NULL)
     OR (scope IN ('READ_CANCEL','MANAGE_SCHEDULE') AND request_id IS NOT NULL));
ALTER TABLE guest_capabilities
  ADD CONSTRAINT guest_capability_expiry
  CHECK (expires_at > created_at);
ALTER TABLE notification_intents
  ADD CONSTRAINT cancellation_intent_scope
  CHECK (cancellation_id IS NULL OR audience IN ('INITIATOR','COUNTERPARTY'));
-- Domain events may notify seller/client without cancellation_id; cancellation
-- events still MUST have exactly two intents referencing cancellation_id.

-- 6. Each cancellation must atomically enqueue EXACTLY TWO logical intents:
-- the initiator's confirmation and counterparty's notification.
-- Keep per-channel attempts in notification_deliveries, not extra logical intents.
CREATE OR REPLACE FUNCTION validate_cancel_notifications() RETURNS trigger AS $$
DECLARE
  cnt integer;
  initiators integer;
  counterparties integer;
BEGIN
  SELECT count(*),count(*) FILTER (WHERE audience='INITIATOR'),
         count(*) FILTER (WHERE audience='COUNTERPARTY')
    INTO cnt,initiators,counterparties
    FROM notification_intents WHERE cancellation_id=NEW.id;
  IF cnt<>2 OR initiators<>1 OR counterparties<>1 THEN
    RAISE EXCEPTION 'Cancellation requires initiator and counterparty notifications'
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE CONSTRAINT TRIGGER cancellation_two_intents
  AFTER INSERT ON cancellation_events
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  EXECUTE FUNCTION validate_cancel_notifications();

-- 7. Intentionally NOT represented solely as SQL CHECK:
-- * guest OTP + scoped-capability security and consent;
-- * actor access/revocation and conditional time-allocation approval;
-- * cancellation time/grace/reliability eligibility and no-show appeal;
-- * review experience verification;
-- * protection of company field-visibility intersection and cache invalidation.
-- These MUST be transactional server-domain policies with negative tests.
--
-- Migration plan: baseline Prisma migration -> this reviewed SQL -> backfill
-- -> staging EXPLAIN/locks/rollback test -> migrate production under controlled window.


-- 8. Reference-only idempotency ledger guards. These constraints apply after
-- generating/reviewing the Prisma baseline migration containing idempotency_records.
ALTER TABLE idempotency_records
  ADD CONSTRAINT idempotency_record_state_valid
  CHECK (state IN ('PROCESSING','COMPLETED','FAILED'));
ALTER TABLE idempotency_records
  ADD CONSTRAINT idempotency_record_expiry_valid
  CHECK (expires_at > created_at);
ALTER TABLE idempotency_records
  ADD CONSTRAINT idempotency_record_response_complete
  CHECK ((state = 'COMPLETED' AND response_status IS NOT NULL)
      OR (state <> 'COMPLETED'));
-- Database uniqueness on actor_scope/method/route/key is emitted from the
-- Prisma @@unique. Never store session IDs, OTP, guest secrets or plain
-- private contacts in actor_scope or response_body. Encrypt/redact responses.
-- For crash-safe execution do not commit PROCESSING separately from the
-- domain effect without a deterministic lease/recovery policy.

-- 9. ADR-0006 design-only schedule proposal constraints.
-- Review against the baseline migration before deploying.
ALTER TABLE schedule_proposals
  ADD CONSTRAINT schedule_proposal_period_valid
  CHECK (proposed_end_at > proposed_start_at AND revision >= 1);
ALTER TABLE schedule_proposals
  ADD CONSTRAINT schedule_proposal_resolution_valid
  CHECK (
    (status = 'PROPOSED' AND resolved_at IS NULL AND resolved_by IS NULL)
    OR (status <> 'PROPOSED' AND resolved_at IS NOT NULL)
  );
ALTER TABLE schedule_proposals
  ADD CONSTRAINT schedule_proposal_opposite_confirmation
  CHECK (status <> 'CONFIRMED' OR (resolved_by IS NOT NULL AND resolved_by <> initiator));
CREATE UNIQUE INDEX schedule_proposal_one_active
  ON schedule_proposals(request_id)
  WHERE status = 'PROPOSED';
-- SQL constraints above do not prove actor authorization, availability,
-- valid IANA timezone, or agreed consent. Backend verifies all of those.
-- ADR-0005 guest READ_CANCEL does NOT grant schedule confirmation:
-- an additional scoped capability must be designed before exposing guest
-- schedule-proposal endpoints in production.

-- ADR-0006: validated schedule scope is bound to exactly one existing request.
-- Domain auth MUST verify the guest's contact against request.guest_contact_id.
ALTER TABLE cancellation_snapshot_revisions
  ADD CONSTRAINT cancellation_snapshot_revision_valid
  CHECK (schedule_revision > 0 AND policy_revision > 0
    AND free_cancel_before_min BETWEEN 0 AND 10080
    AND free_cancel_until <= scheduled_start_at);
-- The unique (request_id, schedule_revision) is defined in Prisma.
-- History must be append-only, including during concurrent reschedules.
CREATE OR REPLACE FUNCTION prevent_cancellation_history_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Cancellation snapshot history is immutable' USING ERRCODE='23514';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER cancellation_snapshot_history_immutable
  BEFORE UPDATE OR DELETE ON cancellation_snapshot_revisions
  FOR EACH ROW EXECUTE FUNCTION prevent_cancellation_history_mutation();
-- customer_penalty_suspended is a safety default during seller-initiated reschedule.
-- Domain layer must set it transactionally BEFORE notifying client; clearing
-- requires client confirmation of new agreement and checked current revision.

-- ADR-0011: once a review's author is detached, erase public free-text and
-- record anonymization. This is NOT the whole Person-erasure procedure.
ALTER TABLE reviews
  ADD CONSTRAINT review_anonymized_author_consistency
  CHECK (author_person_id IS NOT NULL OR
    (anonymized_at IS NOT NULL AND comment IS NULL));
-- A production migration needs a backfill/review of old rows and retention
-- rules before changing the FK from RESTRICT to SET NULL.


-- G0 ADR-0007/0012/0013: request-performer assignment and affiliation termination
-- share the same row lock so concurrent assignment and termination cannot both win.
-- A withdrawal of publication consent is INDEPENDENT of operational closure.
CREATE OR REPLACE FUNCTION lock_active_request_affiliation() RETURNS trigger AS $$
DECLARE
  affiliation_record_id UUID;
BEGIN
  IF NEW.seller_organization_id IS NULL OR NEW.performer_professional_id IS NULL THEN
    RETURN NEW;
  END IF;
  -- Existing cancellations/completions may proceed without renewed affiliation.
  IF TG_OP = 'UPDATE' AND
     NEW.performer_professional_id IS NOT DISTINCT FROM OLD.performer_professional_id AND
     NEW.seller_organization_id IS NOT DISTINCT FROM OLD.seller_organization_id THEN
    RETURN NEW;
  END IF;
  SELECT id INTO affiliation_record_id
  FROM affiliations
  WHERE organization_id = NEW.seller_organization_id
    AND professional_id = NEW.performer_professional_id
    AND status = 'ACTIVE'
  ORDER BY id LIMIT 1 FOR UPDATE;
  IF affiliation_record_id IS NULL THEN
    RAISE EXCEPTION 'Assigned performer must have active affiliation'
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER service_request_performer_active_affiliation
  BEFORE INSERT OR UPDATE OF seller_organization_id, performer_professional_id
  ON service_requests FOR EACH ROW EXECUTE FUNCTION lock_active_request_affiliation();

CREATE OR REPLACE FUNCTION guard_affiliation_operational_close() RETURNS trigger AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'ENDED' THEN
    IF EXISTS (
      SELECT 1 FROM service_requests r
      WHERE r.seller_organization_id = NEW.organization_id
        AND r.performer_professional_id = NEW.professional_id
        AND r.status IN ('PENDING','ACCEPTED')
    ) THEN
      RAISE EXCEPTION 'Resolve assigned active company requests before ending affiliation'
        USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER affiliation_operational_close_guard
  BEFORE UPDATE OF status ON affiliations
  FOR EACH ROW EXECUTE FUNCTION guard_affiliation_operational_close();

-- No-show requires an accepted request and the same confirmed schedule revision.
-- Moderation authorization and customer response are enforced by the domain API.
CREATE OR REPLACE FUNCTION validate_no_show_claim() RETURNS trigger AS $$
DECLARE
  r_status TEXT;
  r_reconcile BOOLEAN;
  r_customer_suspended BOOLEAN;
  start_instant TIMESTAMPTZ;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.request_id IS DISTINCT FROM OLD.request_id OR
       NEW.schedule_revision IS DISTINCT FROM OLD.schedule_revision OR
       NEW.seller_reported_at IS DISTINCT FROM OLD.seller_reported_at THEN
      RAISE EXCEPTION 'No-show claim event identity is immutable' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  SELECT status::text, schedule_reconciliation_required, customer_penalty_suspended
    INTO r_status, r_reconcile, r_customer_suspended
    FROM service_requests WHERE id = NEW.request_id FOR UPDATE;
  SELECT scheduled_start_at INTO start_instant
    FROM cancellation_snapshot_revisions
    WHERE request_id = NEW.request_id AND schedule_revision = NEW.schedule_revision;
  IF r_status IS DISTINCT FROM 'ACCEPTED' OR start_instant IS NULL OR
     r_reconcile IS DISTINCT FROM FALSE OR r_customer_suspended IS DISTINCT FROM FALSE OR
     NEW.seller_reported_at < start_instant + interval '15 minutes' OR
     NEW.seller_reported_at > statement_timestamp() + interval '5 seconds' THEN
    RAISE EXCEPTION 'No-show requires accepted confirmed non-disputed time and 15-minute grace'
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER no_show_claim_eligibility
  BEFORE INSERT OR UPDATE ON no_show_claims
  FOR EACH ROW EXECUTE FUNCTION validate_no_show_claim();
ALTER TABLE no_show_claims
  ADD CONSTRAINT no_show_claim_adjudication_required
  CHECK (status NOT IN ('CONFIRMED','REJECTED') OR
    (reviewed_at IS NOT NULL AND reviewed_by_user_id IS NOT NULL AND decision_reason_code IS NOT NULL));

-- On any permission or visibility change, revoke old materialization synchronously;
-- a later worker recomputes versioned public data. Public GET must still verify
-- READY + current sourceRevision before serving an HTTP/CDN cached response.
CREATE OR REPLACE FUNCTION invalidate_company_publication() RETURNS trigger AS $$
BEGIN
  IF (OLD.master_allowed_fields IS DISTINCT FROM NEW.master_allowed_fields OR
      OLD.company_selected_fields IS DISTINCT FROM NEW.company_selected_fields OR
      OLD.company_content IS DISTINCT FROM NEW.company_content OR
      OLD.published_at IS DISTINCT FROM NEW.published_at OR
      OLD.revision IS DISTINCT FROM NEW.revision) THEN
    IF NEW.revision <= OLD.revision THEN
      RAISE EXCEPTION 'Company view mutation must increment revision' USING ERRCODE='23514';
    END IF;
    UPDATE published_company_professional_views
       SET state='STALE' WHERE view_id=NEW.id AND state <> 'REVOKED';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER company_view_publication_invalidated
  AFTER UPDATE ON company_professional_views
  FOR EACH ROW EXECUTE FUNCTION invalidate_company_publication();

CREATE OR REPLACE FUNCTION revoke_company_view_on_affiliation_end() RETURNS trigger AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status AND NEW.status <> 'ACTIVE' THEN
    UPDATE published_company_professional_views p SET state='REVOKED'
      FROM company_professional_views v
      WHERE v.id=p.view_id AND v.affiliation_id=NEW.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER affiliation_publication_revocation
  AFTER UPDATE OF status ON affiliations
  FOR EACH ROW EXECUTE FUNCTION revoke_company_view_on_affiliation_end();

-- A delayed/out-of-order worker must not publish an obsolete revision as READY.
-- Lock both parent rows to serialize with permission changes and affiliation closure.
CREATE OR REPLACE FUNCTION guard_published_company_view_ready() RETURNS trigger AS $$
DECLARE
  actual_revision INTEGER;
  affiliation_state TEXT;
BEGIN
  IF NEW.state = 'READY' THEN
    SELECT v.revision, a.status::text INTO actual_revision, affiliation_state
      FROM company_professional_views v
      JOIN affiliations a ON a.id = v.affiliation_id
      WHERE v.id = NEW.view_id
      FOR SHARE OF v, a;
    IF actual_revision IS NULL OR affiliation_state <> 'ACTIVE'
       OR NEW.source_revision <> actual_revision THEN
      RAISE EXCEPTION 'Cannot publish stale or unauthorized company view'
        USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER published_company_view_revision_guard
  BEFORE INSERT OR UPDATE ON published_company_professional_views
  FOR EACH ROW EXECUTE FUNCTION guard_published_company_view_ready();

ALTER TABLE published_company_professional_views
  ADD CONSTRAINT published_view_revision_and_payload_valid
  CHECK (source_revision > 0 AND (state <> 'READY' OR public_payload IS NOT NULL));
ALTER TABLE guest_recovery_sessions
  ADD CONSTRAINT guest_recovery_session_valid
  CHECK (expires_at > created_at AND (revoked_at IS NULL OR revoked_at >= created_at));
ALTER TABLE guest_challenges
  ADD CONSTRAINT guest_challenge_consumption_valid
  CHECK (consumed_at IS NULL OR consumed_at >= created_at);

-- Cancellation intents remain non-null FK-linked to a parent domain outbox event;
-- insert event, then two intents, then commit in a SINGLE transaction.
-- Do NOT move the two-intents constraint to the asynchronous worker.

-- Historical affiliations must be retained for request audit; never hard-delete.
CREATE OR REPLACE FUNCTION prevent_affiliation_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Affiliation deletion forbidden: end operational link with retained history'
    USING ERRCODE='23514';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER affiliation_no_hard_delete
  BEFORE DELETE ON affiliations FOR EACH ROW EXECUTE FUNCTION prevent_affiliation_delete();

