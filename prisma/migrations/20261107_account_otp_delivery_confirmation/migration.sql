-- OTP is not redeemable until a trusted provider has accepted delivery.
-- Existing unconfirmed challenges fail closed; do not backfill to accepted.
ALTER TABLE account_auth_challenges
  ADD COLUMN delivery_confirmed_at TIMESTAMPTZ(3);
