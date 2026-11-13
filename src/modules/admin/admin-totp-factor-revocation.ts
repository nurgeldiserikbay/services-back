import type {Pool,PoolClient} from 'pg';
import {hashAdminSessionToken} from './admin-session-token.js';

const STAFF_UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Privileged server-only security operation. The caller MUST independently
 * authorize the revocation (e.g. an authenticated security administrator).
 * Disabling the factor and revoking every active privileged session are atomic.
 * The replay watermark is intentionally retained: an old code cannot be reused.
 */
export async function revokeAdminTotpFactorAndSessions(
 pool:Pick<Pool,'connect'>,
 staffId:unknown,
 actorToken:unknown,
 sessionPepper:Buffer,
 now=Date.now(),
):Promise<boolean>{
 if(typeof staffId!=='string'||!STAFF_UUID.test(staffId)||
    !Number.isSafeInteger(now)||now<0)return false;
 let actorHash:string;
 try{actorHash=hashAdminSessionToken(actorToken,sessionPepper);}
 catch{return false;}
 const client:PoolClient=await pool.connect();
 let began=false;
 try{
  await client.query('BEGIN');
  began=true;
  await client.query(
   'SELECT pg_advisory_xact_lock(hashtextextended($1::text, 104729))',
   [staffId],
  );
  // Only a live, MFA-verified security administrator can revoke a factor.
  // Authorization is checked inside the same transaction as revocation.
  const authority=await client.query<{staff_id:string}>(`
   SELECT actor.id::text AS staff_id
   FROM platform_admin_sessions session
   JOIN platform_admin_staff actor ON actor.id=session.staff_id
   JOIN users usr ON usr.id=actor.user_id
   WHERE session.token_hash=$1 AND session.revoked_at IS NULL
     AND session.expires_at>to_timestamp($2::double precision/1000)
     AND session.mfa_verified_at IS NOT NULL
     AND actor.disabled_at IS NULL AND usr.status='ACTIVE'
     AND actor.role='owner'
     AND EXISTS (SELECT 1 FROM platform_admin_grants grant_row
       WHERE grant_row.staff_id=actor.id AND grant_row.scope='platform.admin.security')
   FOR SHARE OF session,actor
  `,[actorHash,now]);
  if(!authority||!Array.isArray(authority.rows)||authority.rows.length>1)
   throw new Error('admin_totp_revocation_authority_unavailable');
  if(authority.rows.length!==1){
   await client.query('ROLLBACK');began=false;return false;
  }
  const actorId=authority.rows[0]?.staff_id;
  if(typeof actorId!=='string'||!STAFF_UUID.test(actorId))
   throw new Error('admin_totp_revocation_authority_unavailable');
  const disabled=await client.query<{staff_id:string}>(`
   UPDATE platform_admin_totp_factors
   SET disabled_at=to_timestamp($2::double precision/1000)
   WHERE staff_id=$1::uuid AND disabled_at IS NULL
   RETURNING staff_id::text
  `,[staffId,now]);
  if(!disabled||!Array.isArray(disabled.rows)||disabled.rows.length>1)
   throw new Error('admin_totp_revocation_unavailable');
  // Revoke sessions even when factor was previously disabled: idempotent
  // security cleanup must not leave an existing privileged bearer usable.
  await client.query(`
   UPDATE platform_admin_sessions
   SET revoked_at=to_timestamp($2::double precision/1000)
   WHERE staff_id=$1::uuid AND revoked_at IS NULL
  `,[staffId,now]);
  // Audit record is committed atomically with factor and session revocation.
  await client.query(`
   INSERT INTO platform_admin_security_events
    (actor_staff_id,target_staff_id,action,occurred_at)
   VALUES ($1::uuid,$2::uuid,'totp_factor_revoked',
           to_timestamp($3::double precision/1000))
  `,[actorId,staffId,now]);
  await client.query('COMMIT');
  began=false;
  return disabled.rows.length===1;
 }catch(error){
  if(began){
   try{await client.query('ROLLBACK');}catch{/* retain original failure */}
  }
  throw error;
 }finally{
  client.release();
 }
}
