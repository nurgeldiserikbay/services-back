-- Reference migration ONLY for a separately approved OTP provider gateway
-- database. NOT a services-back/Prisma migration; never apply automatically
-- to the main application database. No raw OTP, phone, email or access token.
--
-- All writers MUST commit this reservation before calling the external
-- provider. Never delete/reclaim RESERVED rows based solely on elapsed time:
-- a timed-out provider could still have delivered the OTP.
CREATE TABLE otp_gateway_delivery_claims (
  idempotency_key char(64) PRIMARY KEY
    CHECK (idempotency_key ~ '^[0-9a-f]{64}$'),
  fingerprint char(64) NOT NULL
    CHECK (fingerprint ~ '^[0-9a-f]{64}$'),
  status varchar(12) NOT NULL DEFAULT 'RESERVED'
    CHECK (status IN ('RESERVED','ACCEPTED')),
  provider_ref varchar(120)
    CHECK (provider_ref ~ '^[a-zA-Z0-9_-]{8,120}$'),
  claimed_at timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz,
  CONSTRAINT otp_gateway_claim_receipt_state CHECK (
    (status='RESERVED' AND provider_ref IS NULL AND accepted_at IS NULL)
    OR
    (status='ACCEPTED' AND provider_ref IS NOT NULL AND accepted_at IS NOT NULL)
  )
);
CREATE INDEX otp_gateway_delivery_claims_review_idx
  ON otp_gateway_delivery_claims (claimed_at)
  WHERE status='RESERVED';

-- Defense in depth: immutable claims after acceptance, and no claim deletion.
-- This reference SQL is for NEW, dedicated gateway DB installations only.
-- Existing deployments need a separately reviewed/approved migration plan.
CREATE FUNCTION otp_gateway_guard_delivery_claim_mutation()
RETURNS trigger
LANGUAGE plpgsql AS $otp_guard$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'otp delivery claim deletion denied';
  END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.status<>'RESERVED' OR NEW.provider_ref IS NOT NULL
       OR NEW.accepted_at IS NOT NULL THEN
      RAISE EXCEPTION 'otp claim must begin reserved';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP='UPDATE' THEN
    IF OLD.status<>'RESERVED' OR NEW.status<>'ACCEPTED'
       OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
       OR NEW.fingerprint IS DISTINCT FROM OLD.fingerprint
       OR NEW.claimed_at IS DISTINCT FROM OLD.claimed_at
       OR NEW.provider_ref IS NULL OR NEW.accepted_at IS NULL THEN
      RAISE EXCEPTION 'otp delivery claim transition denied';
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'unsupported otp delivery claim mutation';
END;
$otp_guard$;

CREATE TRIGGER otp_gateway_guard_claim_insert
BEFORE INSERT ON otp_gateway_delivery_claims
FOR EACH ROW EXECUTE FUNCTION otp_gateway_guard_delivery_claim_mutation();

CREATE TRIGGER otp_gateway_guard_claim_update
BEFORE UPDATE ON otp_gateway_delivery_claims
FOR EACH ROW EXECUTE FUNCTION otp_gateway_guard_delivery_claim_mutation();

CREATE TRIGGER otp_gateway_guard_claim_delete
BEFORE DELETE ON otp_gateway_delivery_claims
FOR EACH ROW EXECUTE FUNCTION otp_gateway_guard_delivery_claim_mutation();

-- DELETE row triggers do not fire for TRUNCATE. Reject it separately.
-- Enforce strict DDL/ownership privileges too: table owners and superusers
-- can change/drop triggers, so this is defense in depth, not an admin boundary.
CREATE FUNCTION otp_gateway_deny_claim_truncate()
RETURNS trigger
LANGUAGE plpgsql AS $otp_no_truncate$
BEGIN
  RAISE EXCEPTION 'otp delivery claim truncate denied';
END;
$otp_no_truncate$;

CREATE TRIGGER otp_gateway_guard_claim_truncate
BEFORE TRUNCATE ON otp_gateway_delivery_claims
FOR EACH STATEMENT EXECUTE FUNCTION otp_gateway_deny_claim_truncate();
