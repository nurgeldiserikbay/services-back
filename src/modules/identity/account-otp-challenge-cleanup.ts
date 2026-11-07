import type {PoolClient} from 'pg';

export const ACCOUNT_OTP_CHALLENGE_RETENTION=Object.freeze({
  afterExpiryHours:25,
  batchLimit:500,
});

/**
 * PRIVATE maintenance only. Delete expired account OTP proofs and encrypted
 * contact records after a conservative retention period. The provider's
 * acceptance marker does not change the expiry-based retention cutoff.
 * Do not call this from HTTP, OTP issuance, verification or startup.
 */
export async function pruneAccountOtpChallenges(
  client:Pick<PoolClient,'query'>,now=new Date(),
):Promise<number>{
  if(!(now instanceof Date)||!Number.isFinite(now.getTime()))
    throw new Error('invalid_account_challenge_cleanup_clock');
  const cutoff=new Date(
    now.getTime()-ACCOUNT_OTP_CHALLENGE_RETENTION.afterExpiryHours*3600000,
  );
  const result=await client.query<{deleted_count:string}>(`
    WITH victims AS (
      SELECT id
      FROM account_auth_challenges
      WHERE expires_at<$1::timestamptz
      ORDER BY expires_at,id
      FOR UPDATE SKIP LOCKED
      LIMIT $2::integer
    ),
    deleted AS (
      DELETE FROM account_auth_challenges AS c
      USING victims
      WHERE c.id=victims.id
      RETURNING c.id
    )
    SELECT count(*)::text AS deleted_count FROM deleted
  `,[cutoff,ACCOUNT_OTP_CHALLENGE_RETENTION.batchLimit]);
  const count=Number(result.rows[0]?.deleted_count);
  if(!Number.isSafeInteger(count)||count<0||
    count>ACCOUNT_OTP_CHALLENGE_RETENTION.batchLimit)
    throw new Error('invalid_account_challenge_cleanup_count');
  return count;
}
