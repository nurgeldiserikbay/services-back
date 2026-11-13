import type {PoolClient} from 'pg';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const WINDOW_MS=15*60*1000;
const LOCK_MS=15*60*1000;

/**
 * Atomic per-staff failed-MFA attempt recording.
 * Must be invoked in its own committed transaction on failed verification:
 * a failed login must not roll back the attempt counter.
 * A separate rate limiter must protect account discovery and primary login.
 */
export async function recordAdminMfaFailure(
 db:Pick<PoolClient,'query'>,
 staffId:unknown,
 now=Date.now(),
):Promise<{failedAttempts:number;lockedUntil:number|null}|null>{
 if(typeof staffId!=='string'||!UUID.test(staffId)||
    !Number.isSafeInteger(now)||now<0||now>Number.MAX_SAFE_INTEGER-LOCK_MS)
  return null;
 const result=await db.query<{
  failed_attempts:number;locked_until:Date|null;
 }>(`
  INSERT INTO platform_admin_mfa_attempts AS attempts
   (staff_id,window_started_at,failed_attempts,locked_until,updated_at)
  SELECT staff.id,to_timestamp($2::double precision/1000),1,NULL,CURRENT_TIMESTAMP
  FROM platform_admin_staff staff
  JOIN users usr ON usr.id=staff.user_id
  WHERE staff.id=$1::uuid AND staff.disabled_at IS NULL AND usr.status='ACTIVE'
  ON CONFLICT (staff_id) DO UPDATE
  SET failed_attempts=CASE
    WHEN attempts.window_started_at<=to_timestamp($3::double precision/1000)
      THEN 1
    ELSE LEAST(attempts.failed_attempts+1,5)
   END,
   window_started_at=CASE
    WHEN attempts.window_started_at<=to_timestamp($3::double precision/1000)
      THEN to_timestamp($2::double precision/1000)
    ELSE attempts.window_started_at
   END,
   locked_until=CASE
    WHEN attempts.locked_until>to_timestamp($2::double precision/1000)
      THEN attempts.locked_until
    WHEN attempts.window_started_at<=to_timestamp($3::double precision/1000)
      THEN NULL
    WHEN attempts.failed_attempts+1>=5
      THEN to_timestamp($4::double precision/1000)
    ELSE NULL
   END,
   updated_at=CURRENT_TIMESTAMP
  RETURNING failed_attempts,locked_until
 `,[staffId,now,now-WINDOW_MS,now+LOCK_MS]);
 if(!result||!Array.isArray(result.rows)||result.rows.length>1)
  throw new Error('admin_mfa_attempt_record_unavailable');
 if(result.rows.length===0)return null;
 const row=result.rows[0];
 if(!row||!Number.isInteger(row.failed_attempts)||
    row.failed_attempts<1||row.failed_attempts>5||
    (row.locked_until!==null&&
     (!(row.locked_until instanceof Date)||
      !Number.isFinite(row.locked_until.getTime()))))
  throw new Error('admin_mfa_attempt_record_unavailable');
 return {failedAttempts:row.failed_attempts,
  lockedUntil:row.locked_until?.getTime()??null};
}
