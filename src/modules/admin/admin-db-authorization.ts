import {extractAdminBearerToken} from './admin-bearer-proof.js';
import {hashAdminSessionToken} from './admin-session-token.js';
import {adminSessionAllowsAction} from './admin-session-gate.js';

type Db={query:(sql:string,params:readonly unknown[])=>Promise<{rows:unknown[]}>};

/**
 * Read-only admin authorization decision. The caller must use a trusted
 * PostgreSQL connection and must not log bearer credentials or query params.
 * No route is exposed by this module.
 */
export async function authorizeAdminAction(
 db:Db,authorization:unknown,pepper:Buffer,requiredScope:string,now:Date,
):Promise<boolean>{
 const token=extractAdminBearerToken(authorization);
 if(token===null||!Buffer.isBuffer(pepper)||pepper.length!==32||
  typeof requiredScope!=='string'||!/^[-a-z0-9:.]{1,80}$/.test(requiredScope)||
  !(now instanceof Date)||!Number.isFinite(now.getTime()))return false;
 const tokenHash=hashAdminSessionToken(token,pepper);
 // Hash is computed before lookup; raw bearer proof never reaches SQL.
 const result=await db.query(`
  SELECT s.expires_at, s.revoked_at, s.mfa_verified_at,
         staff.disabled_at, staff.role, u.status AS user_status,
         EXISTS (
           SELECT 1 FROM platform_admin_grants g
           WHERE g.staff_id=staff.id AND g.scope=$2
         ) AS has_scope
  FROM platform_admin_sessions s
  JOIN platform_admin_staff staff ON staff.id=s.staff_id
  JOIN users u ON u.id=staff.user_id
  WHERE s.token_hash=$1
  LIMIT 1
 `,[tokenHash,requiredScope]);
 if(result.rows.length!==1)return false;
 const row=result.rows[0];
 if(typeof row!=='object'||row===null)return false;
 const r=row as Record<string,unknown>;
 if(r.has_scope!==true)return false;
 return adminSessionAllowsAction({
  now,expiresAt:r.expires_at as Date,revokedAt:r.revoked_at as Date|null,
  mfaVerifiedAt:r.mfa_verified_at as Date|null,
  staffDisabledAt:r.disabled_at as Date|null,
  userStatus:r.user_status as string,role:r.role as string,
  grants:[requiredScope],requiredScope,
 });
}
