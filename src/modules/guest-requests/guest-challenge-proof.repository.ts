import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DatabasePool } from '../../platform/database/database.pool.js';
import {
  GUEST_OTP_POLICY, hashOtp, hashGuestCapability, issueGuestCapability,
} from './guest-request.security.js';

/**
 * One atomic SQL statement claims the challenge, counts each attempted code,
 * and persists a CREATE_REQUEST capability only after successful proof.
 * A concurrent verifier observes consumed_at and can never issue a second proof.
 */
export const VERIFY_CREATE_REQUEST_CHALLENGE_SQL = `
  WITH attempt AS (
    UPDATE guest_challenges ch
    SET attempts = ch.attempts + 1,
        consumed_at = CASE WHEN ch.code_hash = $2::text
                           THEN now() ELSE ch.consumed_at END
    FROM guest_contacts c
    WHERE ch.id = $1::uuid
      AND c.id = ch.guest_contact_id
      AND ch.purpose = 'CREATE_REQUEST'
      AND ch.consumed_at IS NULL
      AND ch.expires_at > now()
      AND ch.attempts < $5::integer
      AND c.expires_at > now()
    RETURNING ch.guest_contact_id, ch.code_hash = $2::text AS matched
  ),
  issued AS (
    INSERT INTO guest_capabilities (
      id, guest_contact_id, scope, token_hash, expires_at
    )
    SELECT $3::uuid, a.guest_contact_id, 'CREATE_REQUEST',
           $4::text, now() + ($6::integer * interval '1 second')
    FROM attempt a WHERE a.matched
    RETURNING id
  )
  SELECT EXISTS (SELECT 1 FROM issued) AS verified
`;

type VerifyResultRow = {verified:boolean};

@Injectable()
export class GuestChallengeProofRepository {
  constructor(private readonly db: DatabasePool) {}

  async verifyCreateRequest(
    challengeId: string,
    enteredCode: string,
    pepper: Buffer,
  ): Promise<{guestCapability: string; expiresInSeconds: number} | null> {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(challengeId) ||
      !/^[0-9]{6}$/.test(enteredCode)) return null;

    const {token, tokenHash} = issueGuestCapability('CREATE_REQUEST', pepper);
    const result = await this.db.query<VerifyResultRow>(VERIFY_CREATE_REQUEST_CHALLENGE_SQL, [
      challengeId,
      hashOtp(challengeId, enteredCode, pepper),
      randomUUID(),
      tokenHash,
      GUEST_OTP_POLICY.maxAttempts,
      GUEST_OTP_POLICY.capabilityTtlSeconds,
    ]);
    if (result.rows[0]?.verified !== true) return null;
    return {guestCapability:token,expiresInSeconds:GUEST_OTP_POLICY.capabilityTtlSeconds};
  }
}
