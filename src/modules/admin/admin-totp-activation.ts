import type {Pool,PoolClient} from 'pg';
import {openAdminTotpSecret} from './admin-totp-secret.js';
import {verifyAdminTotp} from './admin-totp.js';
import {consumeAdminTotpCounter} from './admin-totp-replay.js';
import {isAdminMfaLocked,recordAdminMfaFailure} from './admin-mfa-attempts.js';
import {recordAdminMfaSecurityEvent} from './admin-mfa-security-audit.js';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const VERSION=/^[A-Za-z0-9_-]{1,64}$/;

/**
 * Trusted, out-of-band enrollment confirmation. A provisioned factor is
 * activated only after a valid code proves possession of its seed.
 * Caller MUST separately authenticate and authorize enrollment; do not
 * expose this primitive directly to unauthenticated HTTP clients.
 */
export async function activateProvisionedAdminTotp(
 pool:Pick<Pool,'connect'>,
 staffId:string,
 code:unknown,
 resolveKey:(version:string)=>Promise<Buffer|null>,
 now=Date.now(),
):Promise<boolean>{
 if(typeof staffId!=='string'||!UUID.test(staffId)||
    typeof code!=='string'||!/^[0-9]{6}$/.test(code)||
    typeof resolveKey!=='function'||!Number.isSafeInteger(now)||now<0)
  return false;
 const client:PoolClient=await pool.connect();
 let began=false;
 let secret:Buffer|null=null;
 try{
  await client.query('BEGIN');
  began=true;
  await client.query(
   'SELECT pg_advisory_xact_lock(hashtextextended($1::text, 104729))',
   [staffId],
  );
  if(await isAdminMfaLocked(client,staffId,now)){
   await client.query('ROLLBACK');began=false;return false;
  }
  const factor=await client.query<{encrypted_secret:string;key_version:string}>(`
   SELECT factor.encrypted_secret,factor.key_version
   FROM platform_admin_totp_factors factor
   JOIN platform_admin_staff staff ON staff.id=factor.staff_id
   JOIN users usr ON usr.id=staff.user_id
   WHERE factor.staff_id=$1::uuid AND factor.activated_at IS NULL
     AND factor.disabled_at IS NULL AND staff.disabled_at IS NULL
     AND usr.status='ACTIVE'
     AND EXISTS (SELECT 1 FROM platform_admin_grants grants
       WHERE grants.staff_id=staff.id)
   FOR UPDATE OF factor
  `,[staffId]);
  if(!factor||!Array.isArray(factor.rows)||factor.rows.length>1)
   throw new Error('admin_totp_activation_unavailable');
  const row=factor.rows[0];
  if(!row||typeof row.encrypted_secret!=='string'||
     typeof row.key_version!=='string'||!VERSION.test(row.key_version)){
   await client.query('ROLLBACK');began=false;return false;
  }
  const key=await resolveKey(row.key_version);
  if(!Buffer.isBuffer(key)||key.length!==32){
   await client.query('ROLLBACK');began=false;return false;
  }
  secret=openAdminTotpSecret(row.encrypted_secret,staffId,key);
  if(!secret){
   await client.query('ROLLBACK');began=false;return false;
  }
  const counter=verifyAdminTotp(secret,code,now,-1);
  if(counter===null){
   // Failed enrollment codes must be committed to the same durable
   // lockout budget as login guesses, never rolled back.
   await recordAdminMfaFailure(client,staffId,now);
   await recordAdminMfaSecurityEvent(client,staffId,'totp_activation_failed');
   await client.query('COMMIT');began=false;return false;
  }
  if(!await consumeAdminTotpCounter(client,staffId,counter)){
   await client.query('ROLLBACK');began=false;return false;
  }
  const activated=await client.query<{staff_id:string}>(`
   UPDATE platform_admin_totp_factors
   SET activated_at=to_timestamp($2::double precision/1000)
   WHERE staff_id=$1::uuid AND activated_at IS NULL AND disabled_at IS NULL
   RETURNING staff_id::text
  `,[staffId,now]);
  if(!activated||!Array.isArray(activated.rows)||
     activated.rows.length!==1||
     activated.rows[0]?.staff_id?.toLowerCase()!==staffId.toLowerCase())
   throw new Error('admin_totp_activation_unavailable');
  await client.query(
   'DELETE FROM platform_admin_mfa_attempts WHERE staff_id=$1::uuid',
   [staffId],
  );
  await recordAdminMfaSecurityEvent(client,staffId,'totp_factor_activated');
  await client.query('COMMIT');
  began=false;
  return true;
 }catch(error){
  if(began){try{await client.query('ROLLBACK');}catch{/* preserve failure */}}
  throw error;
 }finally{
  secret?.fill(0);
  client.release();
 }
}
