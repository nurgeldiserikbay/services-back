import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {hashAdminSessionToken} from './admin-session-token.js';

const HASH=/^[0-9a-f]{64}$/;
const SCOPE=/^[a-z][a-z0-9_-]{0,31}:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_MS=3_600_000;
type Db=Pick<PoolClient,'query'>;
type Context=Readonly<{
 /** Resolved from privileged server custody, NEVER from the browser. */
 adminBearer:string;adminPepper:Buffer;
 /** Server-determined appeal resource scope, never browser-authored. */
 resourceScope:string;
 now?:number;
}>;

/**
 * Prepared, unregistered PostgreSQL browser session issuance adapter.
 * A single atomic INSERT .. SELECT admits only an active authorized platform
 * admin session with recent TOTP MFA, enabled staff, active user and explicit
 * matching grant. It stores only the new browser token's HMAC, never bearer.
 * No controller, key management or trusted bearer provisioning is included.
 * Any ambiguous/failed insert returns false; SQL errors propagate fail closed.
 *
 * This statement does not replace per-operation authorization and cannot
 * guarantee revocation linearizability across a concurrent admin-session UPDATE.
 */
export function createAppealBffPgAuthorizedSessionInsert(db:Db,context:Context){
 return async(tokenHash:string,expiresAt:number):Promise<boolean>=>{
  const now=context?.now??Date.now();
  if(!db||typeof db.query!=='function'||!context||
   typeof tokenHash!=='string'||!HASH.test(tokenHash)||
   typeof context.resourceScope!=='string'||!SCOPE.test(context.resourceScope)||
   !Number.isSafeInteger(now)||now<0||now>8_640_000_000_000_000-MAX_MS||
   !Number.isSafeInteger(expiresAt)||expiresAt<=now||
   expiresAt-now>MAX_MS)return false;
  let adminHash:string;
  try{adminHash=hashAdminSessionToken(context.adminBearer,context.adminPepper);}
  catch{return false;}
  const id=randomUUID();
  const result=await db.query<{id:string}>(`
   INSERT INTO platform_admin_appeal_browser_sessions
     (id,staff_id,token_hash,expires_at)
   SELECT $1::uuid,staff.id,$2::char(64),
     to_timestamp($3::double precision/1000.0)
   FROM platform_admin_sessions AS auth
   JOIN platform_admin_staff AS staff ON staff.id=auth.staff_id
   JOIN users AS usr ON usr.id=staff.user_id
   WHERE auth.token_hash=$4
     AND auth.revoked_at IS NULL
     AND auth.created_at<=to_timestamp($6::double precision/1000.0)
     AND auth.expires_at>to_timestamp($6::double precision/1000.0)
     AND auth.expires_at>=to_timestamp($3::double precision/1000.0)
     AND auth.expires_at>auth.mfa_verified_at
     AND auth.mfa_verified_at<=to_timestamp($6::double precision/1000.0)
     AND auth.mfa_verified_at>=to_timestamp(($6::double precision-900000)/1000.0)
     AND staff.disabled_at IS NULL AND staff.role IN ('owner','admin')
     AND usr.status='ACTIVE'
     AND EXISTS (
       SELECT 1 FROM platform_admin_totp_factors AS factor
       WHERE factor.staff_id=staff.id
         AND factor.activated_at IS NOT NULL
         AND factor.activated_at<=auth.mfa_verified_at
         AND factor.disabled_at IS NULL
     )
     AND EXISTS (
       SELECT 1 FROM platform_admin_grants AS scoped_grant
       WHERE scoped_grant.staff_id=staff.id AND scoped_grant.scope=$5
     )
   RETURNING id::text AS id
  `,[id,tokenHash,expiresAt,adminHash,context.resourceScope,now]);
  return !!result&&Array.isArray(result.rows)&&result.rows.length===1&&
   result.rows[0]?.id===id;
 };
}
