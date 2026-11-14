import type {PoolClient} from 'pg';
import {hashAdminSessionToken} from './admin-session-token.js';

const MAX_DATE_MS=8_640_000_000_000_000;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Server-side primitive only; NOT a public endpoint.
 * The caller must authenticate the actor and authorize revocation before use.
 * The raw token is never persisted or logged. Repeated revocations are no-ops.
 */
export async function revokePlatformAdminSession(
 db:Pick<PoolClient,'query'>,token:unknown,pepper:Buffer,
 staffId:unknown,now=Date.now(),
):Promise<boolean>{
 if(typeof staffId!=='string'||!UUID.test(staffId)||
  !Number.isSafeInteger(now)||now<0||now>MAX_DATE_MS)return false;
 let hash:string;
 try{hash=hashAdminSessionToken(token,pepper);}catch{return false;}
 const result=await db.query<{id:string}>(`
  UPDATE platform_admin_sessions
  SET revoked_at=to_timestamp($3::double precision/1000.0)
  WHERE token_hash=$1 AND staff_id=$2::uuid
   AND revoked_at IS NULL
   AND created_at<=to_timestamp($3::double precision/1000.0)
  RETURNING id::text
 `,[hash,staffId,now]);
 if(!result||!Array.isArray(result.rows)||result.rows.length>1||
  (result.rows.length===1&&(!result.rows[0]||
   typeof result.rows[0].id!=='string'||!UUID.test(result.rows[0].id))))
  throw new Error('admin_session_revocation_unavailable');
 return result.rows.length===1;
}


/**
 * Self-logout: possession of the exact canonical admin bearer is sufficient
 * to revoke that same session, but never another staff member's sessions.
 * Expired sessions may still be revoked; repeated requests are idempotent.
 * A caller must not log the bearer or hash.
 */
export async function revokeOwnPlatformAdminSession(
 db:Pick<PoolClient,'query'>,token:unknown,pepper:Buffer,now=Date.now(),
):Promise<boolean>{
 if(!Number.isSafeInteger(now)||now<0||now>MAX_DATE_MS)return false;
 let hash:string;
 try{hash=hashAdminSessionToken(token,pepper);}catch{return false;}
 const result=await db.query<{id:string}>(`
  UPDATE platform_admin_sessions
  SET revoked_at=to_timestamp($2::double precision/1000.0)
  WHERE token_hash=$1
    AND revoked_at IS NULL
    AND created_at<=to_timestamp($2::double precision/1000.0)
  RETURNING id::text
 `,[hash,now]);
 if(!result||!Array.isArray(result.rows)||result.rows.length>1||
    (result.rows.length===1&&(!result.rows[0]||
      typeof result.rows[0].id!=='string'||!UUID.test(result.rows[0].id))))
  throw new Error('admin_session_revocation_unavailable');
 return result.rows.length===1;
}
