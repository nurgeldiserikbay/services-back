import type { PoolClient } from 'pg';

/**
 * Contact-level OTP send budget. This is only ONE layer of abuse prevention.
 * Caller must BEGIN a transaction, check the quota, insert a challenge within
 * that SAME transaction, and COMMIT. On send failures the delivery/attempt
 * state must be reconciled without reopening a public issuance route.
 */
export const SEND_QUOTA = Object.freeze({
  perHour: 3,
  perDay: 8,
  minIntervalSeconds: 60,
});

type CountRow = {last_created_at:Date|null;hour_count:string;day_count:string};

export type ContactSendQuotaResult={
  allowed:boolean;
  retryAfterSeconds:number;
  reason:'ok'|'cooldown'|'hourly'|'daily';
};

/** The digest is already a keyed HMAC; no raw recipient is logged or queried. */
export async function checkContactSendQuota(
  client:Pick<PoolClient,'query'>,
  digest:string,
  now=new Date(),
):Promise<ContactSendQuotaResult>{
  if(!/^[a-f0-9]{64}$/.test(digest))throw new Error('invalid_digest');
  if(!Number.isFinite(now.getTime()))throw new Error('invalid_time');

  // Serialize quota checks on the recipient digest across all API processes.
  // Do NOT call outside the insertion transaction: otherwise parallel sends
  // can both pass the same check before a challenge has been inserted.
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))',
    ['guest-otp-send-v1',digest]);
  const result=await client.query<CountRow>(`
    SELECT MAX(ch.created_at) AS last_created_at,
      COUNT(*) FILTER (
        WHERE ch.created_at > $2::timestamptz - interval '1 hour'
      )::text AS hour_count,
      COUNT(*) FILTER (
        WHERE ch.created_at > $2::timestamptz - interval '24 hours'
      )::text AS day_count
    FROM guest_challenges ch
    JOIN guest_contacts contact ON contact.id=ch.guest_contact_id
    WHERE contact.digest=$1
      AND ch.purpose IN ('CREATE_REQUEST','MANAGE_SCHEDULE')
      AND ch.created_at > $2::timestamptz - interval '24 hours'
  `,[digest,now]);
  const row=result.rows[0];
  if(!row)throw new Error('quota_query_failed');
  const perHour=Number(row.hour_count);
  const perDay=Number(row.day_count);
  if(!Number.isSafeInteger(perHour)||!Number.isSafeInteger(perDay))
    throw new Error('invalid_quota_counts');
  const elapsed=row.last_created_at
    ? Math.floor((now.getTime()-row.last_created_at.getTime())/1000)
    : Infinity;
  if(perDay>=SEND_QUOTA.perDay)
    return {allowed:false,retryAfterSeconds:86400,reason:'daily'};
  if(perHour>=SEND_QUOTA.perHour)
    return {allowed:false,retryAfterSeconds:3600,reason:'hourly'};
  if(elapsed<SEND_QUOTA.minIntervalSeconds)
    return {allowed:false,
      retryAfterSeconds:Math.max(1,SEND_QUOTA.minIntervalSeconds-elapsed),
      reason:'cooldown'};
  return {allowed:true,retryAfterSeconds:0,reason:'ok'};
}
