import type {PoolClient} from 'pg';

export const ACCOUNT_OTP_NETWORK_RETENTION=Object.freeze({
  minimumHours:25,
  batchLimit:500,
});

/**
 * Delete only account-network issuance records older than rolling 24h
 * quota window plus a 1h safety margin. Bounded and lock-skipping so a
 * maintenance worker cannot block live account OTP issuance.
 *
 * No network identifiers or row contents leave this function.
 * Caller supplies server-controlled time, never an HTTP-provided timestamp.
 */
export async function pruneAccountOtpNetworkLedger(
  client:Pick<PoolClient,'query'>,now=new Date(),
):Promise<number>{
  if(!(now instanceof Date)||!Number.isFinite(now.getTime()))
    throw new Error('invalid_account_network_cleanup_time');
  const cutoff=new Date(
    now.getTime()-ACCOUNT_OTP_NETWORK_RETENTION.minimumHours*3600000);
  const result=await client.query<{deleted_count:string}>(`
    WITH victims AS (
      SELECT id
      FROM account_otp_network_issuances
      WHERE created_at<$1::timestamptz
      ORDER BY created_at,id
      FOR UPDATE SKIP LOCKED
      LIMIT $2::integer
    ),
    deleted AS (
      DELETE FROM account_otp_network_issuances AS ledger
      USING victims
      WHERE ledger.id=victims.id
      RETURNING ledger.id
    )
    SELECT count(*)::text AS deleted_count FROM deleted
  `,[cutoff,ACCOUNT_OTP_NETWORK_RETENTION.batchLimit]);
  const count=Number(result.rows[0]?.deleted_count);
  if(!Number.isSafeInteger(count)||count<0||
    count>ACCOUNT_OTP_NETWORK_RETENTION.batchLimit)
    throw new Error('invalid_account_network_cleanup_count');
  return count;
}
