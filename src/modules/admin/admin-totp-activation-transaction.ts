import type {Pool,PoolClient} from 'pg';
import {activateAdminTotpFactor} from './admin-totp-factor-activation.js';
import {isAdminMfaLocked,recordAdminMfaFailure} from './admin-mfa-attempts.js';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Transaction boundary for trusted TOTP enrollment.
 * The primary factor must already be authenticated by the caller.
 * Enrollment proof consumption and activation are atomic.
 */
export async function activateAdminTotpInTransaction(
 pool:Pick<Pool,'connect'>,
 primary:{staffId:string;authenticatedAt:number},
 code:unknown,
 resolveKey:(version:string)=>Promise<Buffer|null>,
 now=Date.now(),
):Promise<boolean>{
 // Do not let malformed identities reach SQL or advisory-lock hashing.
 if(!primary||typeof primary!=='object'||Array.isArray(primary)||
    Object.getPrototypeOf(primary)!==Object.prototype||
    Object.keys(primary).length!==2||
    typeof primary.staffId!=='string'||!UUID.test(primary.staffId)||
    !Number.isSafeInteger(primary.authenticatedAt)||
    !Number.isSafeInteger(now)||now<0||
    primary.authenticatedAt<0||primary.authenticatedAt>now||
    now-primary.authenticatedAt>300000||
    typeof code!=='string'||code.length>32)return false;
 const staffId=primary.staffId;
 const client:PoolClient=await pool.connect();
 let began=false;
 try{
  await client.query('BEGIN');
  began=true;
  // Serialize enrollment with MFA issuance and account lockout checks.
  await client.query(
   'SELECT pg_advisory_xact_lock(hashtextextended($1::text, 104729))',
   [staffId],
  );
  if(await isAdminMfaLocked(client,staffId,now)){
   await client.query('ROLLBACK');
   began=false;
   return false;
  }
  const activated=await activateAdminTotpFactor(
   client,staffId,code,resolveKey,now,
  );
  if(!activated){
   // Invalid enrollment proofs count toward the same durable lockout as
   // login attempts. Commit the failure, not the activation.
   await recordAdminMfaFailure(client,staffId,now);
   await client.query('COMMIT');
   began=false;
   return false;
  }
  await client.query('DELETE FROM platform_admin_mfa_attempts WHERE staff_id=$1::uuid',[staffId]);
  await client.query('COMMIT');
  began=false;
  return true;
 }catch(error){
  if(began){
   try{await client.query('ROLLBACK');}catch{/* preserve original failure */}
  }
  throw error;
 }finally{
  client.release();
 }
}
