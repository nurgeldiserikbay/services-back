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
