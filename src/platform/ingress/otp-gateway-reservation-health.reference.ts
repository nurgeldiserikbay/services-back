import type {Pool} from 'pg';

/**
 * Read-only, aggregate-only diagnostic for the DEDICATED OTP gateway database.
 * Never import into Nest/public routes, expose per-key rows or use results to
 * automatically reclaim/retry ambiguous RESERVED deliveries.
 * Requires a separate SELECT-only operator database role.
 */
export type OtpGatewayReservationHealth=Readonly<{
  unresolvedCount:string;
  oldestClaimedAt:string|null;
}>;

const UNAVAILABLE='otp_gateway_reservation_health_unavailable';

/** No idempotency key, fingerprint, destination, code, token or provider ref. */
export async function readOtpGatewayReservationHealth(
  db:Pick<Pool,'query'>,
):Promise<OtpGatewayReservationHealth>{
  try{
    if(!db||typeof db.query!=='function')throw new Error(UNAVAILABLE);
    const result=await db.query<{
      unresolved_count:string;
      oldest_claimed_at:Date|null;
    }>(`
      SELECT count(*)::text AS unresolved_count,
             min(claimed_at) AS oldest_claimed_at
      FROM otp_gateway_delivery_claims
      WHERE status='RESERVED'
    `);
    if(result.rows.length!==1)throw new Error(UNAVAILABLE);
    const row=result.rows[0];
    if(!row||typeof row.unresolved_count!=='string'||
       !/^(0|[1-9][0-9]*)$/.test(row.unresolved_count))
      throw new Error(UNAVAILABLE);
    const count=BigInt(row.unresolved_count);
    const oldest=row.oldest_claimed_at;
    if((count===0n)!==(oldest===null))throw new Error(UNAVAILABLE);
    if(oldest!==null&&
       (!(oldest instanceof Date)||!Number.isFinite(oldest.getTime())))
      throw new Error(UNAVAILABLE);
    return {
      unresolvedCount:row.unresolved_count,
      oldestClaimedAt:oldest===null?null:oldest.toISOString(),
    };
  }catch{
    // Database errors, SQL error payloads and malformed rows are not exposed.
    throw new Error(UNAVAILABLE);
  }
}
