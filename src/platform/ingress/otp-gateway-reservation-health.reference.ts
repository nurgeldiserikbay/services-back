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

/**
 * Observation-only age histogram. Thresholds are descriptive 5m/1h
 * boundaries, NOT agreed delivery SLOs or automatic retry deadlines.
 * Future-dated claims are deliberately in no bucket: an unmatched total
 * must fail closed instead of silently classifying clock-skewed data as new.
 */
export type OtpGatewayReservationAgeBuckets=Readonly<{
  total:string;
  underFiveMinutes:string;
  fiveMinutesToOneHour:string;
  oneHourOrOlder:string;
}>;

/** Restricted-role SELECT uses only status and claimed_at columns. */
export async function readOtpGatewayReservationAgeBuckets(
  db:Pick<Pool,'query'>,
):Promise<OtpGatewayReservationAgeBuckets>{
  try{
    if(!db||typeof db.query!=='function')throw new Error(UNAVAILABLE);
    const result=await db.query<{
      total:string;
      recent:string;
      middle:string;
      older:string;
    }>(`
      SELECT count(*)::text AS total,
        count(*) FILTER (
          WHERE claimed_at >= now() - interval '5 minutes'
            AND claimed_at <= now()
        )::text AS recent,
        count(*) FILTER (
          WHERE claimed_at < now() - interval '5 minutes'
            AND claimed_at >= now() - interval '1 hour'
        )::text AS middle,
        count(*) FILTER (
          WHERE claimed_at < now() - interval '1 hour'
        )::text AS older
      FROM otp_gateway_delivery_claims
      WHERE status='RESERVED'
    `);
    if(result.rows.length!==1)throw new Error(UNAVAILABLE);
    const row=result.rows[0];
    if(!row)throw new Error(UNAVAILABLE);
    const values=[row.total,row.recent,row.middle,row.older];
    if(values.some(v=>typeof v!=='string'||!/^(0|[1-9][0-9]*)$/.test(v)))
      throw new Error(UNAVAILABLE);
    const [total,recent,middle,older]=values.map(v=>BigInt(v));
    if(recent+middle+older!==total)throw new Error(UNAVAILABLE);
    return {
      total:row.total,
      underFiveMinutes:row.recent,
      fiveMinutesToOneHour:row.middle,
      oneHourOrOlder:row.older,
    };
  }catch{
    throw new Error(UNAVAILABLE);
  }
}

/**
 * One PostgreSQL statement supplies a consistent aggregate view: count,
 * oldest claim, and age histogram all share a statement snapshot and now().
 * This is not an HTTP endpoint, alert, expiry or resend/reclaim instruction.
 */
export type OtpGatewayReservationSnapshot=
  OtpGatewayReservationHealth & OtpGatewayReservationAgeBuckets;

export async function readOtpGatewayReservationSnapshot(
  db:Pick<Pool,'query'>,
):Promise<OtpGatewayReservationSnapshot>{
  try{
    if(!db||typeof db.query!=='function')throw new Error(UNAVAILABLE);
    const result=await db.query<{
      total:string;
      oldest_claimed_at:Date|null;
      recent:string;
      middle:string;
      older:string;
    }>(`
      SELECT count(*)::text AS total,
        min(claimed_at) AS oldest_claimed_at,
        count(*) FILTER (
          WHERE claimed_at >= now() - interval '5 minutes'
            AND claimed_at <= now()
        )::text AS recent,
        count(*) FILTER (
          WHERE claimed_at < now() - interval '5 minutes'
            AND claimed_at >= now() - interval '1 hour'
        )::text AS middle,
        count(*) FILTER (
          WHERE claimed_at < now() - interval '1 hour'
        )::text AS older
      FROM otp_gateway_delivery_claims
      WHERE status='RESERVED'
    `);
    if(result.rows.length!==1)throw new Error(UNAVAILABLE);
    const row=result.rows[0];
    if(!row)throw new Error(UNAVAILABLE);
    const counts=[row.total,row.recent,row.middle,row.older];
    if(counts.some(x=>typeof x!=='string'||
      !/^(0|[1-9][0-9]*)$/.test(x)))throw new Error(UNAVAILABLE);
    const [total,recent,middle,older]=counts.map(x=>BigInt(x));
    if(total!==recent+middle+older)throw new Error(UNAVAILABLE);
    const oldest=row.oldest_claimed_at;
    if((total===0n)!==(oldest===null))throw new Error(UNAVAILABLE);
    if(oldest!==null&&(!(oldest instanceof Date)||
      !Number.isFinite(oldest.getTime())))throw new Error(UNAVAILABLE);
    return {
      unresolvedCount:row.total,
      oldestClaimedAt:oldest===null?null:oldest.toISOString(),
      total:row.total,
      underFiveMinutes:row.recent,
      fiveMinutesToOneHour:row.middle,
      oneHourOrOlder:row.older,
    };
  }catch{
    throw new Error(UNAVAILABLE);
  }
}
