-- Real PostgreSQL smoke tests for Prisma baseline + constraints.sql.
-- A single transaction intentionally rolls back all fixture rows.
-- This does NOT replace comprehensive concurrency, auth, privacy or migration tests.
BEGIN;
DO $smoke$
DECLARE
  owner_user UUID := gen_random_uuid();
  owner_person UUID := gen_random_uuid();
  customer_user UUID := gen_random_uuid();
  customer_person UUID := gen_random_uuid();
  profession_id UUID := gen_random_uuid();
  professional_id UUID := gen_random_uuid();
  service_id UUID := gen_random_uuid();
  personal_offer UUID := gen_random_uuid();
  company_id UUID := gen_random_uuid();
  bad_offer UUID := gen_random_uuid();
  request_id UUID := gen_random_uuid();
  cancellation_id UUID := gen_random_uuid();
  outbox_id UUID := gen_random_uuid();
  created_event_id UUID := gen_random_uuid();
  guest_contact_id UUID := gen_random_uuid();
  busy_id UUID := gen_random_uuid();
  did_reject BOOLEAN;
  affiliation_id UUID := gen_random_uuid();
  corporate_offer_id UUID := gen_random_uuid();
  corporate_request_id UUID := gen_random_uuid();
  company_view_id UUID := gen_random_uuid();
  recent_request_id UUID := gen_random_uuid();
BEGIN
  INSERT INTO users(id,email) VALUES(owner_user,'owner-smoke@example.invalid'),(customer_user,'client-smoke@example.invalid');
  INSERT INTO persons(id,user_id) VALUES(owner_person,owner_user),(customer_person,customer_user);
  INSERT INTO professions(id,code,name) VALUES(profession_id,'smoke-electrician','Electrician');
  INSERT INTO professional_profiles(id,person_id,profession_id,slug)
    VALUES(professional_id,owner_person,profession_id,'smoke-electrician');
  INSERT INTO service_definitions(id,code,name) VALUES(service_id,'smoke-install','Install');
  INSERT INTO organizations(id,owner_person_id,slug,name)
    VALUES(company_id,owner_person,'smoke-org','Smoke company');

  -- Offer must have exactly one seller, not zero.
  did_reject := false;
  BEGIN
    INSERT INTO service_offers(id,definition_id,title,delivery_mode,contacts)
      VALUES(bad_offer,service_id,'Broken','online','{}'::jsonb);
  EXCEPTION WHEN check_violation THEN
    did_reject := true;
  END;
  IF NOT did_reject THEN RAISE EXCEPTION 'XOR offer guard did not reject'; END IF;

  INSERT INTO service_offers(id,definition_id,professional_id,title,delivery_mode,contacts)
    VALUES(personal_offer,service_id,professional_id,'Personal installation','online','{}'::jsonb);

  -- Passwordless account challenge and separate guest capabilities are real entities.
  INSERT INTO account_auth_challenges(id,channel,purpose,contact_digest,contact_cipher,code_hash,expires_at)
    VALUES(gen_random_uuid(),'EMAIL','SIGN_IN','digest-smoke','ciphertext-smoke','codehash-smoke',now()+interval '5 minutes');
  INSERT INTO guest_contacts(id,channel,encrypted_value,digest,expires_at)
    VALUES(guest_contact_id,'email','ciphertext-smoke','digest-guest-smoke',now()+interval '1 day');
  INSERT INTO guest_capabilities(id,guest_contact_id,scope,token_hash,expires_at)
    VALUES(gen_random_uuid(),guest_contact_id,'CREATE_REQUEST','guest-token-smoke',now()+interval '15 minutes');
  did_reject := false;
  BEGIN
    INSERT INTO guest_capabilities(id,guest_contact_id,scope,token_hash,expires_at)
      VALUES(gen_random_uuid(),guest_contact_id,'READ_CANCEL','invalid-cap-smoke',now()+interval '1 day');
  EXCEPTION WHEN check_violation THEN
    did_reject := true;
  END;
  IF NOT did_reject THEN RAISE EXCEPTION 'Guest read/cancel scope without request was allowed'; END IF;

  -- Expired recovery sessions cannot be stored, and recovery OTP purpose is isolated.
  INSERT INTO guest_challenges(id,guest_contact_id,code_hash,purpose,expires_at)
    VALUES(gen_random_uuid(),guest_contact_id,'recovery-codehash','RECOVER_REQUEST',now()+interval '5 minutes');
  INSERT INTO guest_recovery_sessions(id,guest_contact_id,token_hash,expires_at)
    VALUES(gen_random_uuid(),guest_contact_id,'recovery-token-smoke',now()+interval '15 minutes');
  did_reject := false;
  BEGIN
    INSERT INTO guest_recovery_sessions(id,guest_contact_id,token_hash,expires_at)
      VALUES(gen_random_uuid(),guest_contact_id,'expired-recovery-smoke',now()-interval '1 hour');
  EXCEPTION WHEN check_violation THEN did_reject := true;
  END;
  IF NOT did_reject THEN RAISE EXCEPTION 'Expired recovery session allowed'; END IF;

  -- User's professional profile is unique per profession, including archived.
  did_reject := false;
  BEGIN
    INSERT INTO professional_profiles(id,person_id,profession_id,slug,status)
      VALUES(gen_random_uuid(),owner_person,profession_id,'smoke-duplicate','ARCHIVED');
  EXCEPTION WHEN unique_violation THEN
    did_reject := true;
  END;
  IF NOT did_reject THEN RAISE EXCEPTION 'Professional unique key did not reject duplicate'; END IF;

  -- Request seller must correspond exactly to the offer.
  did_reject := false;
  BEGIN
    INSERT INTO service_requests(id,offer_id,customer_person_id,source_context,seller_organization_id)
      VALUES(request_id,personal_offer,customer_person,'PERSONAL',company_id);
  EXCEPTION WHEN check_violation THEN
    did_reject := true;
  END;
  IF NOT did_reject THEN RAISE EXCEPTION 'Request seller trigger did not reject wrong seller'; END IF;

  INSERT INTO service_requests(id,offer_id,customer_person_id,source_context,seller_professional_id,status,scheduled_start_at,scheduled_end_at)
    VALUES(request_id,personal_offer,customer_person,'PERSONAL',professional_id,'ACCEPTED',
      '2030-01-01 10:00:00+00','2030-01-01 11:00:00+00');

  -- The same company-performer pair cannot be operationally ended while an
  -- accepted or pending corporate request is assigned to this professional.
  INSERT INTO affiliations(id,organization_id,professional_id,status,specialist_approved_at,company_approved_at)
    VALUES(affiliation_id,company_id,professional_id,'ACTIVE',now(),now());
  INSERT INTO service_offers(id,definition_id,organization_id,title,delivery_mode,contacts)
    VALUES(corporate_offer_id,service_id,company_id,'Corporate installation','online','{}'::jsonb);
  INSERT INTO service_requests(id,offer_id,customer_person_id,source_context,seller_organization_id,performer_professional_id,status)
    VALUES(corporate_request_id,corporate_offer_id,customer_person,'ORGANIZATION',company_id,professional_id,'PENDING');
  did_reject := false;
  BEGIN
    UPDATE affiliations SET status='ENDED',ended_at=now() WHERE id=affiliation_id;
  EXCEPTION WHEN check_violation THEN did_reject := true;
  END;
  IF NOT did_reject THEN RAISE EXCEPTION 'Active corporate request did not block affiliation end'; END IF;

  INSERT INTO company_professional_views(id,affiliation_id,professional_id,organization_id,
    master_allowed_fields,company_selected_fields,revision,published_at)
    VALUES(company_view_id,affiliation_id,professional_id,company_id,'{}'::jsonb,'{}'::jsonb,1,now());
  INSERT INTO published_company_professional_views(view_id,source_revision,state,public_payload)
    VALUES(company_view_id,1,'READY','{}'::jsonb);
  UPDATE company_professional_views SET revision=2,company_selected_fields='{"bio":false}'::jsonb
    WHERE id=company_view_id;
  IF (SELECT state::text FROM published_company_professional_views WHERE view_id=company_view_id) <> 'STALE' THEN
    RAISE EXCEPTION 'Company publication was not invalidated on permission change';
  END IF;
  -- A lagging worker cannot re-publish stale sourceRevision=1 after view becomes 2.
  did_reject := false;
  BEGIN
    UPDATE published_company_professional_views SET state='READY' WHERE view_id=company_view_id;
  EXCEPTION WHEN check_violation THEN did_reject := true;
  END;
  IF NOT did_reject THEN RAISE EXCEPTION 'Stale worker was able to publish old company view'; END IF;
  UPDATE service_requests SET status='DECLINED',version=version+1 WHERE id=corporate_request_id;
  UPDATE affiliations SET status='ENDED',ended_at=now() WHERE id=affiliation_id;
  IF (SELECT state::text FROM published_company_professional_views WHERE view_id=company_view_id) <> 'REVOKED' THEN
    RAISE EXCEPTION 'Ended affiliation did not revoke public projection';
  END IF;

  -- A verified schedule is needed for no-show, and seller claims must wait 15 minutes.
  INSERT INTO service_requests(id,offer_id,customer_person_id,source_context,seller_professional_id,
    status,accepted_at,scheduled_start_at,scheduled_end_at)
    VALUES(recent_request_id,personal_offer,customer_person,'PERSONAL',professional_id,
      'ACCEPTED',now()-interval '2 hours',now()-interval '20 minutes',now()+interval '40 minutes');
  INSERT INTO cancellation_snapshot_revisions(id,request_id,schedule_revision,policy_revision,
    scheduled_start_at,free_cancel_before_min,free_cancel_until,agreed_at,timezone)
    VALUES(gen_random_uuid(),recent_request_id,1,1,now()-interval '20 minutes',120,
      now()-interval '2 hours',now()-interval '2 hours','Asia/Almaty');
  did_reject := false;
  BEGIN
    INSERT INTO no_show_claims(id,request_id,schedule_revision,seller_reported_at)
      VALUES(gen_random_uuid(),recent_request_id,1,now()-interval '10 minutes');
  EXCEPTION WHEN check_violation THEN did_reject := true;
  END;
  IF NOT did_reject THEN RAISE EXCEPTION 'No-show before 15-minute threshold was allowed'; END IF;
  INSERT INTO no_show_claims(id,request_id,schedule_revision,seller_reported_at)
    VALUES(gen_random_uuid(),recent_request_id,1,now());
  did_reject := false;
  BEGIN
    UPDATE no_show_claims AS n SET status='CONFIRMED' WHERE n.request_id=recent_request_id;
  EXCEPTION WHEN check_violation THEN did_reject := true;
  END;
  IF NOT did_reject THEN RAISE EXCEPTION 'No-show confirmed without moderator decision'; END IF;

  -- Generic request.created notification works without a fake CancellationEvent.
  INSERT INTO domain_outbox_events(id,topic,subject_kind,subject_id)
    VALUES(created_event_id,'request.created','ServiceRequest',request_id);
  INSERT INTO notification_intents(id,domain_event_id,recipient_person_id,audience,channel,dedupe_key)
    VALUES(gen_random_uuid(),created_event_id,owner_person,'SELLER','in_app','smoke-created');
  IF (SELECT count(*) FROM notification_intents AS n WHERE n.domain_event_id=created_event_id AND n.cancellation_id IS NULL) <> 1 THEN
    RAISE EXCEPTION 'Non-cancellation notification was not stored';
  END IF;

  INSERT INTO busy_blocks(id,professional_id,request_id,start_at,end_at,context)
    VALUES(busy_id,professional_id,request_id,'2030-01-01 10:00:00+00','2030-01-01 11:00:00+00','PERSONAL');

  did_reject := false;
  BEGIN
    INSERT INTO busy_blocks(id,professional_id,organization_id,start_at,end_at,context)
      VALUES(gen_random_uuid(),professional_id,company_id,'2030-01-01 10:30:00+00','2030-01-01 11:30:00+00','ORGANIZATION');
  EXCEPTION WHEN exclusion_violation THEN
    did_reject := true;
  END;
  IF NOT did_reject THEN RAISE EXCEPTION 'Busy overlap GiST did not reject'; END IF;

  -- A contiguous interval is allowed, even if it belongs to another context.
  INSERT INTO busy_blocks(id,professional_id,start_at,end_at,context)
    VALUES(gen_random_uuid(),professional_id,'2030-01-01 11:00:00+00','2030-01-01 12:00:00+00','PERSONAL');

  UPDATE service_requests SET status='CANCELLED_BY_CUSTOMER',version=version+1 WHERE id=request_id;
  DELETE FROM busy_blocks WHERE id=busy_id;
  INSERT INTO cancellation_events(id,request_id,actor,reason_code)
    VALUES(cancellation_id,request_id,'CUSTOMER','changed_plans');
  INSERT INTO domain_outbox_events(id,topic,subject_kind,subject_id)
    VALUES(outbox_id,'request.cancelled','ServiceRequest',request_id);
  INSERT INTO notification_intents(id,domain_event_id,cancellation_id,recipient_person_id,audience,channel,dedupe_key)
    VALUES(gen_random_uuid(),outbox_id,cancellation_id,customer_person,'INITIATOR','in_app','smoke-confirm'),
          (gen_random_uuid(),outbox_id,cancellation_id,owner_person,'COUNTERPARTY','in_app','smoke-other');

  -- Real DB checks the deferred "exactly two" trigger at constraint evaluation.
  SET CONSTRAINTS cancellation_two_intents IMMEDIATE;

  IF (SELECT count(*) FROM notification_intents WHERE dedupe_key IN ('smoke-confirm','smoke-other')) <> 2 THEN
    RAISE EXCEPTION 'Expected two notification intents';
  END IF;
  RAISE NOTICE 'Postgres smoke passed: seller XOR, professional unique, OTP/capability scopes, seller routing, busy overlap, two intents';
END
$smoke$;
ROLLBACK;
