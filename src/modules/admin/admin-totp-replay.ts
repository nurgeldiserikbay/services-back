import type {PoolClient} from 'pg';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Atomically advance a provisioned admin's TOTP replay watermark.
 * Must run in the SAME database transaction as privileged session issuance,
 * after primary authentication and independent TOTP verification.
 * Never commit a watermark if session issuance fails.
 */
export async function consumeAdminTotpCounter(
 db:Pick<PoolClient,'query'>,
 staffId:unknown,
 counter:unknown,
):Promise<boolean>{
 if(typeof staffId!=='string'||!UUID.test(staffId)||
    typeof counter!=='number'||!Number.isSafeInteger(counter)||counter<0)
  return false;
 const result=await db.query<{last_consumed_counter:string}>(`
  INSERT INTO platform_admin_totp_replay
    (staff_id,last_consumed_counter,updated_at)
  SELECT staff.id,$2::bigint,CURRENT_TIMESTAMP
  FROM platform_admin_staff staff
  JOIN users usr ON usr.id=staff.user_id
  WHERE staff.id=$1::uuid AND staff.disabled_at IS NULL
    AND usr.status='ACTIVE'
    AND staff.role IN ('owner','admin','operator','auditor')
    AND EXISTS (SELECT 1 FROM platform_admin_grants g
                WHERE g.staff_id=staff.id)
    AND EXISTS (SELECT 1 FROM platform_admin_totp_factors factor
                WHERE factor.staff_id=staff.id
                  AND factor.activated_at IS NOT NULL
                  AND factor.disabled_at IS NULL)
  ON CONFLICT (staff_id) DO UPDATE
  SET last_consumed_counter=EXCLUDED.last_consumed_counter,
      updated_at=CURRENT_TIMESTAMP
  WHERE platform_admin_totp_replay.last_consumed_counter
        < EXCLUDED.last_consumed_counter
  RETURNING last_consumed_counter::text
 `,[staffId,counter]);
 if(!result||!Array.isArray(result.rows)||result.rows.length>1||
    (result.rows.length===1&&result.rows[0]?.last_consumed_counter!==String(counter)))
  throw new Error('admin_totp_replay_unavailable');
 return result.rows.length===1;
}
