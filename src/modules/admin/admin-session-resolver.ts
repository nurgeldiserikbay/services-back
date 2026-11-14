import type {PoolClient} from 'pg';
import {hashAdminSessionToken} from './admin-session-token.js';
import {
 canPerformAdminOperation,
 type AdminOperation,
 type VerifiedAdminPrincipal,
} from './admin-authorization.policy.js';

const TOKEN=/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ROLES=new Set(['owner','admin','operator','auditor']);
const SCOPE=/^[a-z][a-z0-9_-]{0,31}:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_GRANTS=100;
const MAX_MFA_AGE_MS=15*60*1000;

type AdminRow={
 user_id:string;role:string;expires_at:Date;
 mfa_verified_at:Date;scope:string|null;
};

/**
 * Read current authoritative role, revocation and grants for every request.
 * Call within a DB transaction. Account/guest token hashes cannot match this
 * admin-only HMAC domain. Does not issue or provision admin sessions.
 */
export async function resolvePlatformAdminSession(
 db:Pick<PoolClient,'query'>,
 bearer:unknown,
 pepper:Buffer,
 now=Date.now(),
):Promise<VerifiedAdminPrincipal|null>{
 if(typeof bearer!=='string'||!TOKEN.test(bearer)||
  !Buffer.isBuffer(pepper)||pepper.length!==32||
  !Number.isSafeInteger(now)||now<0||now>8_640_000_000_000_000)return null;
 const hash=hashAdminSessionToken(bearer,pepper);
 const result=await db.query<AdminRow>(`
 SELECT usr.id::text AS user_id, staff.role,
   session.expires_at, session.mfa_verified_at,
   grants.scope
 FROM platform_admin_sessions session
 JOIN platform_admin_staff staff ON staff.id=session.staff_id
 JOIN users usr ON usr.id=staff.user_id
 LEFT JOIN platform_admin_grants grants ON grants.staff_id=staff.id
 WHERE session.token_hash=$1
  AND session.revoked_at IS NULL
  AND session.expires_at>to_timestamp($2::double precision/1000.0)
  AND session.mfa_verified_at<=to_timestamp($2::double precision/1000.0)
  AND session.mfa_verified_at>=to_timestamp(($2::double precision-900000)/1000.0)
  AND staff.disabled_at IS NULL AND usr.status='ACTIVE'
  AND EXISTS (
   SELECT 1 FROM platform_admin_totp_factors factor
   WHERE factor.staff_id=staff.id
     AND factor.activated_at IS NOT NULL
     AND factor.activated_at<=session.mfa_verified_at
     AND factor.disabled_at IS NULL
  )
 ORDER BY grants.scope ASC NULLS LAST
 LIMIT 101
 `,[hash,now]);
 // A malformed driver result must never become a 500 or an authorization grant.
 if(!result||!Array.isArray(result.rows))return null;
 const rows=result.rows;
 // A LEFT JOIN returns one null-scope row for a principal with no grants.
 // Exactly 100 explicit grants are valid; 101 rows indicate overflow.
 if(rows.length===0||rows.length>MAX_GRANTS)return null;
 const first=rows[0];
 if(!first||typeof first.user_id!=='string'||!UUID.test(first.user_id)||
  typeof first.role!=='string'||!ROLES.has(first.role)||
  !(first.expires_at instanceof Date)||
  !(first.mfa_verified_at instanceof Date))return null;
 const expiresAt=first.expires_at.getTime();
 const mfaVerifiedAt=first.mfa_verified_at.getTime();
 if(!Number.isSafeInteger(expiresAt)||!Number.isSafeInteger(mfaVerifiedAt)||
  expiresAt<=now||mfaVerifiedAt>now||now-mfaVerifiedAt>MAX_MFA_AGE_MS)return null;
 const scopes: string[]=[];
 const seenScopes=new Set<string>();
 let sawNullScope=false;
 for(const row of rows){
  // Validate every joined row before dereferencing date objects. A malformed
  // DB result must deny access rather than trigger a 500 or partial grant.
  if(!row||row.user_id!==first.user_id||row.role!==first.role||
    !(row.expires_at instanceof Date)||
    !(row.mfa_verified_at instanceof Date)||
    row.expires_at.getTime()!==expiresAt||
    row.mfa_verified_at.getTime()!==mfaVerifiedAt)return null;
  if(row.scope===null){
   // A LEFT JOIN yields a null grant only when there are no grants at all.
   // Mixed null and non-null rows indicate an inconsistent result.
   sawNullScope=true;
  }else{
   if(typeof row.scope!=='string'||!SCOPE.test(row.scope)||
     seenScopes.has(row.scope.toLowerCase()))return null;
   seenScopes.add(row.scope.toLowerCase());
   scopes.push(row.scope);
  }
 }
 if(sawNullScope&&(rows.length!==1||scopes.length!==0))return null;
 return {userId:first.user_id,role:first.role as VerifiedAdminPrincipal['role'],
  sessionExpiresAt:expiresAt,mfaVerifiedAt,resourceScopes:scopes};
}

/** Derive permission from fresh database state, never client-supplied roles. */
export async function canAccessPlatformAdminResource(
 db:Pick<PoolClient,'query'>,
 bearer:unknown,pepper:Buffer,operation:AdminOperation,
 resourceScope:string,now=Date.now(),
):Promise<boolean>{
 const principal=await resolvePlatformAdminSession(db,bearer,pepper,now);
 return canPerformAdminOperation(principal,operation,resourceScope,now);
}
