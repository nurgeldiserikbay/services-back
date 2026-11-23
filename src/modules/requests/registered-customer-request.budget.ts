import type {PoolClient} from 'pg';

/**
 * Fixed, cross-instance registered customer request issuance limits.
 * A transaction-level advisory lock serializes separate idempotency keys
 * for the same verified Person. The lock MUST be held until COMMIT/ROLLBACK.
 * Retries with an already committed idempotency key are checked BEFORE this.
 */
export const REGISTERED_REQUEST_BUDGET=Object.freeze({
 perMinute:5,
 perHour:20,
 perDay:50,
});
export type RegisteredRequestBudgetResult=Readonly<{
 allowed:boolean;
 retryAfterSeconds:number;
 reason:'ok'|'account_minute'|'account_hour'|'account_day';
}>;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type CountRow={minute_count:string;hour_count:string;day_count:string};

/**
 * Call only after a live account session resolved this person's ID.
 * Database clock and persisted request rows, not frontend timestamps or
 * mutable in-memory counters, are the authority. A cancelled request still
 * consumes budget, to prevent rapid create/cancel bursts.
 */
export async function checkRegisteredRequestBudget(
 client:Pick<PoolClient,'query'>,
 personId:string,
):Promise<RegisteredRequestBudgetResult>{
 if(typeof personId!=='string'||!UUID.test(personId))
  throw new Error('invalid_registered_request_actor');
 await client.query(
  'SELECT pg_advisory_xact_lock(hashtext($1::text),hashtext($2::text))',
  ['registered-request-budget:v1',personId.toLowerCase()],
 );
 const found=await client.query<CountRow>(`
  SELECT
    count(*) FILTER(WHERE created_at>now()-interval '1 minute')::text AS minute_count,
    count(*) FILTER(WHERE created_at>now()-interval '1 hour')::text AS hour_count,
    count(*)::text AS day_count
  FROM service_requests
  WHERE customer_person_id=$1::uuid
    AND created_at>now()-interval '24 hours'
 `,[personId.toLowerCase()]);
 const row=found.rows[0];
 if(!row)throw new Error('registered_request_budget_unavailable');
 const minute=Number(row.minute_count),hour=Number(row.hour_count),
  day=Number(row.day_count);
 if(![minute,hour,day].every(Number.isSafeInteger)||
    minute<0||minute>hour||hour>day)
  throw new Error('registered_request_budget_invalid_counts');
 if(day>=REGISTERED_REQUEST_BUDGET.perDay)
  return {allowed:false,retryAfterSeconds:86400,reason:'account_day'};
 if(hour>=REGISTERED_REQUEST_BUDGET.perHour)
  return {allowed:false,retryAfterSeconds:3600,reason:'account_hour'};
 if(minute>=REGISTERED_REQUEST_BUDGET.perMinute)
  return {allowed:false,retryAfterSeconds:60,reason:'account_minute'};
 return {allowed:true,retryAfterSeconds:0,reason:'ok'};
}
