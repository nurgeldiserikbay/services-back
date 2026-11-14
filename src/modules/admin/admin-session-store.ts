import type {Pool,PoolClient} from 'pg';
import {hashAdminSessionToken} from './admin-session-token.js';
import {authorizeAdminRead,type VerifiedAdminReader} from './admin-authorize-read.js';
import type {AdminReadCapability} from './admin-read-policy.js';
import type {AdminSessionRecord} from './admin-session-verification.js';

type DbReader=Pick<Pool,'query'>|Pick<PoolClient,'query'>;

/**
 * Only the HMAC token hash is sent to PostgreSQL. Never query by raw bearer
 * token or accept a client-provided user ID/role. The account status and
 * disabled staff flag are checked on every read, not cached in the token.
 */
export async function authorizeAdminReadFromDatabase(
  db:DbReader,token:unknown,pepper:Buffer,now:Date,
  capability:AdminReadCapability,
):Promise<VerifiedAdminReader|null>{
  if(!(now instanceof Date)||!Number.isFinite(now.getTime()))return null;
  let tokenHash:string;
  try{tokenHash=hashAdminSessionToken(token,pepper);}
  catch{return null;}
  const result=await db.query<AdminSessionRecord>(`
    SELECT s.token_hash,st.role,st.user_id,s.expires_at,s.revoked_at,
           st.disabled_at,s.mfa_verified_at
    FROM platform_admin_sessions AS s
    JOIN platform_admin_staff AS st ON st.id=s.staff_id
    JOIN users AS u ON u.id=st.user_id
    WHERE s.token_hash=$1
      AND s.expires_at>$2
      AND s.revoked_at IS NULL
      AND st.disabled_at IS NULL
      AND u.status='ACTIVE'
    LIMIT 1
  `,[tokenHash,now]);
  if(!result||!Array.isArray(result.rows)||result.rows.length!==1||
     !result.rows[0])return null;
  return authorizeAdminRead(token,result.rows[0],pepper,now,capability);
}
