import type {PoolClient} from 'pg';

/**
 * Shared PostgreSQL send budget across every API process. This is a second
 * defense in addition to per-contact send limits; network and provider budgets
 * must also be enforced before public HTTP issuance is enabled.
 *
 * Caller MUST invoke in the SAME transaction as the challenge INSERT.
 * Acquire this global advisory lock BEFORE the contact advisory lock to
 * preserve a consistent lock order and avoid deadlocks.
 */
export const GLOBAL_SEND_QUOTA=Object.freeze({
  perMinute:30,
  perHour:300,
  perDay:3000,
});

export type GlobalSendQuotaResult=Readonly<{
  allowed:boolean;
  retryAfterSeconds:number;
  reason:'ok'|'global_minute'|'global_hourly'|'global_daily';
}>;

type CountRow={minute_count:string;hour_count:string;day_count:string};

export async function checkGlobalSendQuota(
  client:Pick<PoolClient,'query'>,
  now=new Date(),
):Promise<GlobalSendQuotaResult>{
  if(!Number.isFinite(now.getTime()))throw new Error('invalid_time');

  // Serialize checks and inserts across horizontally scaled instances.
  // Must precede the per-recipient lock in the same transaction.
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))',
    ['guest-otp-global-v1','CREATE_REQUEST']);
  const result=await client.query<CountRow>(`
    SELECT
      COUNT(*) FILTER (
        WHERE created_at > $1::timestamptz - interval '1 minute'
      )::text AS minute_count,
      COUNT(*) FILTER (
        WHERE created_at > $1::timestamptz - interval '1 hour'
      )::text AS hour_count,
      COUNT(*)::text AS day_count
    FROM guest_challenges
    WHERE purpose='CREATE_REQUEST'
      AND created_at > $1::timestamptz - interval '24 hours'
  `,[now]);
  const row=result.rows[0];
  if(!row)throw new Error('quota_query_failed');
  const minute=Number(row.minute_count),hour=Number(row.hour_count),
    day=Number(row.day_count);
  if(![minute,hour,day].every(Number.isSafeInteger) ||
     minute<0||hour<0||day<0 || minute>hour || hour>day)
    throw new Error('invalid_quota_counts');
  if(day>=GLOBAL_SEND_QUOTA.perDay)
    return {allowed:false,retryAfterSeconds:86400,reason:'global_daily'};
  if(hour>=GLOBAL_SEND_QUOTA.perHour)
    return {allowed:false,retryAfterSeconds:3600,reason:'global_hourly'};
  if(minute>=GLOBAL_SEND_QUOTA.perMinute)
    return {allowed:false,retryAfterSeconds:60,reason:'global_minute'};
  return {allowed:true,retryAfterSeconds:0,reason:'ok'};
}
