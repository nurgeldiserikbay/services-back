import type {PoolClient} from 'pg';

export const NETWORK_RETENTION=Object.freeze({
  minimumHours:25,
  batchLimit:500,
});

/**
 * Delete only network quota rows strictly older than the maximum 24-hour
 * rolling budget plus one hour of safety margin. Uses a bounded CTE and
 * SKIP LOCKED, so concurrent maintenance instances cannot delete the same
 * row or block live OTP inserts. Never return network identifiers.
 *
 * A caller provides trusted database time, never a timestamp from an HTTP
 * request. The quota path reads only rows from the last 24h.
 */
export async function pruneGuestOtpNetworkLedger(
  client:Pick<PoolClient,'query'>,
  now=new Date(),
):Promise<number>{
  if(!Number.isFinite(now.getTime()))throw new Error('invalid_cleanup_time');
  const cutoff=new Date(now.getTime()-NETWORK_RETENTION.minimumHours*3600000);
  const result=await client.query<{deleted_count:string}>(`
    WITH victims AS (
      SELECT id
      FROM guest_otp_network_issuances
      WHERE created_at < $1::timestamptz
      ORDER BY created_at,id
      FOR UPDATE SKIP LOCKED
      LIMIT $2::integer
    ),
    deleted AS (
      DELETE FROM guest_otp_network_issuances AS ledger
      USING victims
      WHERE ledger.id=victims.id
      RETURNING ledger.id
    )
    SELECT count(*)::text AS deleted_count FROM deleted
  `,[cutoff,NETWORK_RETENTION.batchLimit]);
  const count=Number(result.rows[0]?.deleted_count);
  if(!Number.isSafeInteger(count)||count<0||
    count>NETWORK_RETENTION.batchLimit)
    throw new Error('invalid_cleanup_count');
  return count;
}
