import type {PoolClient} from 'pg';

export const ACCOUNT_OTP_GLOBAL_BUDGET=Object.freeze({
  perMinute:30,
  perHour:300,
  perDay:3000,
});

export type AccountOtpGlobalBudgetResult=Readonly<{
  allowed:boolean;
  retryAfterSeconds:number;
  reason:'ok'|'global_minute'|'global_hour'|'global_day';
}>;
type CountRow={minute_count:string;hour_count:string;day_count:string};

/**
 * Transactional, cross-process issuance ceiling for account SIGN_IN/SIGN_UP.
 * Acquire this global lock BEFORE the contact lock and challenge INSERT.
 * Count BOTH purposes and channels, including spent/expired challenges.
 * Never expose this helper's counts to an untrusted API caller.
 */
export async function checkAccountOtpGlobalBudget(
  client:Pick<PoolClient,'query'>,
):Promise<AccountOtpGlobalBudgetResult>{
  await client.query(
    'SELECT pg_advisory_xact_lock(hashtext($1::text),hashtext($2::text))',
    ['account-otp-global:v1','all'],
  );
  const result=await client.query<CountRow>(`
    SELECT
      count(*) FILTER (WHERE created_at>now()-interval '1 minute')::text
        AS minute_count,
      count(*) FILTER (WHERE created_at>now()-interval '1 hour')::text
        AS hour_count,
      count(*)::text AS day_count
    FROM account_auth_challenges
    WHERE created_at>now()-interval '24 hours'
  `,[]);
  const row=result.rows[0];
  if(!row)throw new Error('account_otp_global_unavailable');
  const minute=Number(row.minute_count);
  const hour=Number(row.hour_count);
  const day=Number(row.day_count);
  if(![minute,hour,day].every(Number.isSafeInteger)||
    minute<0||hour<minute||day<hour)
    throw new Error('account_otp_global_invalid_counts');
  if(day>=ACCOUNT_OTP_GLOBAL_BUDGET.perDay)
    return {allowed:false,retryAfterSeconds:86400,reason:'global_day'};
  if(hour>=ACCOUNT_OTP_GLOBAL_BUDGET.perHour)
    return {allowed:false,retryAfterSeconds:3600,reason:'global_hour'};
  if(minute>=ACCOUNT_OTP_GLOBAL_BUDGET.perMinute)
    return {allowed:false,retryAfterSeconds:60,reason:'global_minute'};
  return {allowed:true,retryAfterSeconds:0,reason:'ok'};
}
