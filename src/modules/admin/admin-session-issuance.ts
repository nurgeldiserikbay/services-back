import type {PoolClient} from 'pg';
import {issueAdminSessionToken} from './admin-session-token.js';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SESSION_MS=15*60*1000;

/**
 * Persist a short-lived privileged session only AFTER an independent trusted
 * login flow has verified MFA. This function is not an HTTP authentication
 * endpoint, does not verify OTPs, and must never accept a browser assertion.
 * Invoke within DatabasePool.transaction so no bearer escapes before COMMIT.
 */
export async function createVerifiedPlatformAdminSession(
 db:Pick<PoolClient,'query'>,
 verified:{staffId:string;mfaVerifiedAt:number},
 pepper:Buffer,
 now=Date.now(),
):Promise<{token:string;expiresAt:number}|null>{
 if(!verified||typeof verified!=='object'||Array.isArray(verified)||
    Object.getPrototypeOf(verified)!==Object.prototype||
    Object.keys(verified).length!==2||
    !Object.hasOwn(verified,'staffId')||!Object.hasOwn(verified,'mfaVerifiedAt')||
    typeof verified.staffId!=='string'||!UUID.test(verified.staffId)||
    !Number.isSafeInteger(verified.mfaVerifiedAt)||verified.mfaVerifiedAt<0||
    !Number.isSafeInteger(now)||now<0||
    verified.mfaVerifiedAt>now||now-verified.mfaVerifiedAt>SESSION_MS||
    now>8640000000000000-SESSION_MS||
    !Buffer.isBuffer(pepper)||pepper.length!==32)return null;
 const {token,tokenHash}=issueAdminSessionToken(pepper);
 const expiresAt=now+SESSION_MS;
 const result=await db.query<{id:string}>(`
  INSERT INTO platform_admin_sessions
   (id,staff_id,token_hash,mfa_verified_at,expires_at,created_at)
  SELECT gen_random_uuid(),staff.id,$2,
   to_timestamp($3::double precision/1000.0),
   to_timestamp($4::double precision/1000.0),
   to_timestamp($5::double precision/1000.0)
  FROM platform_admin_staff staff
  JOIN users usr ON usr.id=staff.user_id
  WHERE staff.id=$1 AND staff.disabled_at IS NULL AND usr.status='ACTIVE'
    AND staff.role IN ('owner','admin','operator','auditor')
    AND EXISTS (SELECT 1 FROM platform_admin_grants grants
                WHERE grants.staff_id=staff.id)
    AND NOT EXISTS (SELECT 1 FROM platform_admin_mfa_attempts attempts
                    WHERE attempts.staff_id=staff.id
                      AND attempts.failed_attempts>=5
                      AND attempts.window_started_at>to_timestamp(($5::double precision-900000)/1000.0)
                      AND attempts.locked_until IS NULL)
    AND NOT EXISTS (SELECT 1 FROM platform_admin_mfa_attempts attempts
                    WHERE attempts.staff_id=staff.id
                      AND attempts.locked_until>to_timestamp($5::double precision/1000.0))
    AND EXISTS (SELECT 1 FROM platform_admin_totp_factors factor
                WHERE factor.staff_id=staff.id
                  AND factor.activated_at IS NOT NULL
                  AND factor.disabled_at IS NULL)
  RETURNING id::text
 `,[verified.staffId,tokenHash,verified.mfaVerifiedAt,expiresAt,now]);
 if(!result||!Array.isArray(result.rows)||result.rows.length>1||
    (result.rows.length===1&&(!result.rows[0]||
     typeof result.rows[0].id!=='string'||!UUID.test(result.rows[0].id))))
  throw new Error('admin_session_creation_unavailable');
 return result.rows.length===1?{token,expiresAt}:null;
}
