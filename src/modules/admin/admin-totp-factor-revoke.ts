import type {Pool,PoolClient} from 'pg';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Trusted server-only incident response. Caller must authorize actor to
 * revoke target; never take actorStaffId directly from a request body.
 * Disabling the factor, revoking sessions and auditing are one transaction.
 */
export async function revokeAdminTotpFactor(
 pool:Pick<Pool,'connect'>,
 actorStaffId:string,
 targetStaffId:string,
 now=Date.now(),
):Promise<boolean>{
 if(typeof actorStaffId!=='string'||!UUID.test(actorStaffId)||
    typeof targetStaffId!=='string'||!UUID.test(targetStaffId)||
    !Number.isSafeInteger(now)||now<0)return false;
 const client:PoolClient=await pool.connect();
 let began=false;
 try{
  await client.query('BEGIN');
  began=true;
  const actor=await client.query<{id:string}>(`
   SELECT staff.id::text AS id FROM platform_admin_staff staff
   JOIN users usr ON usr.id=staff.user_id
   WHERE staff.id=$1::uuid AND staff.disabled_at IS NULL
     AND usr.status='ACTIVE'
     AND EXISTS (SELECT 1 FROM platform_admin_grants grants
       WHERE grants.staff_id=staff.id)
   FOR SHARE OF staff
  `,[actorStaffId]);
  if(!actor||!Array.isArray(actor.rows)||actor.rows.length!==1||
     actor.rows[0]?.id?.toLowerCase()!==actorStaffId.toLowerCase()){
   await client.query('ROLLBACK');began=false;return false;
  }
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
