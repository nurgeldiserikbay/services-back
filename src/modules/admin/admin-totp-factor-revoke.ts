import type {Pool,PoolClient} from 'pg';
import {hashAdminSessionToken} from './admin-session-token.js';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Trusted server-only incident response. Caller must authorize actor to
 * revoke target; the actor is derived from the server-verified bearer,
 * never from a browser-supplied staff or session identifier.
 * Disabling the factor, revoking sessions and auditing are one transaction.
 */
export async function revokeAdminTotpFactor(
 pool:Pick<Pool,'connect'>,
 actorToken:unknown,
 targetStaffId:string,
 sessionPepper:Buffer,
 now=Date.now(),
):Promise<boolean>{
 if(typeof targetStaffId!=='string'||!UUID.test(targetStaffId)||
    !Number.isSafeInteger(now)||now<0)return false;
 let tokenHash:string;
 try{tokenHash=hashAdminSessionToken(actorToken,sessionPepper);}
 catch{return false;}
 const client:PoolClient=await pool.connect();
 let began=false;
 try{
  await client.query('BEGIN');
  began=true;
  // Acquire the target lock BEFORE any row locks. MFA login and activation
  // take this advisory lock first; reversing the order risks deadlock.
  await client.query(
   'SELECT pg_advisory_xact_lock(hashtextextended($1::text, 104729))',
   [targetStaffId],
  );
  const actor=await client.query<{id:string}>(`
   SELECT staff.id::text AS id FROM platform_admin_staff staff
   JOIN users usr ON usr.id=staff.user_id
   JOIN platform_admin_sessions session ON session.staff_id=staff.id
   WHERE session.token_hash=$1
     AND session.revoked_at IS NULL
     AND session.expires_at>to_timestamp($2::double precision/1000)
     AND session.mfa_verified_at IS NOT NULL
     AND staff.disabled_at IS NULL AND usr.status='ACTIVE'
     AND staff.role='owner'
     AND EXISTS (SELECT 1 FROM platform_admin_grants grants
       WHERE grants.staff_id=staff.id AND grants.scope='admin.security.revoke')
   FOR SHARE OF staff,session
  `,[tokenHash,now]);
  if(!actor||!Array.isArray(actor.rows)||actor.rows.length!==1||
     typeof actor.rows[0]?.id!=='string'||!UUID.test(actor.rows[0].id)){
   await client.query('ROLLBACK');began=false;return false;
  }
  const actorStaffId=actor.rows[0]!.id;
  const factor=await client.query<{staff_id:string}>(`
   UPDATE platform_admin_totp_factors
   SET disabled_at=to_timestamp($2::double precision/1000)
   WHERE staff_id=$1::uuid AND disabled_at IS NULL
   RETURNING staff_id::text
  `,[targetStaffId,now]);
  if(!factor||!Array.isArray(factor.rows)||factor.rows.length>1)
   throw new Error('admin_totp_revocation_unavailable');
  if(factor.rows.length===0){
   await client.query('ROLLBACK');began=false;return false;
  }
  if(factor.rows[0]?.staff_id?.toLowerCase()!==targetStaffId.toLowerCase())
   throw new Error('admin_totp_revocation_unavailable');
  await client.query(`
   UPDATE platform_admin_sessions
   SET revoked_at=to_timestamp($2::double precision/1000)
   WHERE staff_id=$1::uuid AND revoked_at IS NULL
  `,[targetStaffId,now]);
  const audit=await client.query<{id:string}>(`
   INSERT INTO platform_admin_security_events
     (actor_staff_id,target_staff_id,action)
   VALUES ($1::uuid,$2::uuid,'totp_factor_revoked')
   RETURNING id::text
  `,[actorStaffId,targetStaffId]);
  if(!audit||!Array.isArray(audit.rows)||audit.rows.length!==1||
     typeof audit.rows[0]?.id!=='string'||!UUID.test(audit.rows[0].id))
   throw new Error('admin_totp_revocation_audit_unavailable');
  await client.query('COMMIT');
  began=false;
  return true;
 }catch(error){
  if(began){try{await client.query('ROLLBACK');}catch{/* retain original error */}}
  throw error;
 }finally{
  client.release();
 }
}
