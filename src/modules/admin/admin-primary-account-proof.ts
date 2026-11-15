import type {PoolClient} from 'pg';
import {hashSessionToken} from '../identity/session-proof.js';

const TOKEN=/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_PRIMARY_AGE_MS=5*60*1000;

/**
 * Resolve a recent, server-issued account sign-in to a platform staff member.
 * A client cannot supply staffId or authenticatedAt. Long-lived account
 * sessions are deliberately insufficient for privileged MFA login.
 * Caller must use the returned proof immediately for TOTP verification.
 */
export async function resolveRecentAdminPrimaryAccountProof(
 db:Pick<PoolClient,'query'>,
 accountBearer:unknown,
 accountPepper:Buffer,
 now=Date.now(),
):Promise<{staffId:string;authenticatedAt:number}|null>{
 if(!db||typeof db.query!=='function'||
    typeof accountBearer!=='string'||!TOKEN.test(accountBearer)||
    !Buffer.isBuffer(accountPepper)||accountPepper.length!==32||
    !Number.isSafeInteger(now)||now<0||now>8640000000000000)return null;
 const hash=hashSessionToken(accountBearer,accountPepper);
 const result=await db.query<{staff_id:string;authenticated_at:Date}>(`
  SELECT staff.id::text AS staff_id,
    session.created_at AS authenticated_at
  FROM sessions session
  JOIN users usr ON usr.id=session.user_id
  JOIN platform_admin_staff staff ON staff.user_id=usr.id
  WHERE session.token_hash=$1
    AND session.revoked_at IS NULL
    AND session.expires_at>to_timestamp($2::double precision/1000.0)
    AND session.created_at<=to_timestamp($2::double precision/1000.0)
    AND session.created_at>=to_timestamp(($2::double precision-300000)/1000.0)
    AND usr.status='ACTIVE'
    AND staff.disabled_at IS NULL
    AND staff.role IN ('owner','admin','operator','auditor')
    AND EXISTS (
      SELECT 1 FROM platform_admin_grants grants
      WHERE grants.staff_id=staff.id
    )
  FOR SHARE OF session,usr,staff
 `,[hash,now]);
 if(!result||!Array.isArray(result.rows)||result.rows.length!==1)return null;
 const row=result.rows[0];
 if(!row||typeof row.staff_id!=='string'||!UUID.test(row.staff_id)||
    !(row.authenticated_at instanceof Date))return null;
 const authenticatedAt=row.authenticated_at.getTime();
 if(!Number.isSafeInteger(authenticatedAt)||authenticatedAt>now||
    now-authenticatedAt>MAX_PRIMARY_AGE_MS)return null;
 return {staffId:row.staff_id,authenticatedAt};
}
