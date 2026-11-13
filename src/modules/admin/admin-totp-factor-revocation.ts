import type {Pool,PoolClient} from 'pg';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i;
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
 now=Date.now(),
):Promise<boolean>{
 if(typeof staffId!=='string'||!STAFF_UUID.test(staffId)||
    !Number.isSafeInteger(now)||now<0)return false;
 const client:PoolClient=await pool.connect();
 let began=false;
 try{
  await client.query('BEGIN');
  began=true;
  await client.query(
   'SELECT pg_advisory_xact_lock(hashtextextended($1::text, 104729))',
   [staffId],
  );
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
