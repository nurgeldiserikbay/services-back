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
