import type {Pool,PoolClient} from 'pg';
import {loadActiveAdminTotpFactor} from './admin-totp-factor-store.js';
import {isAdminMfaLocked,recordAdminMfaFailure} from './admin-mfa-attempts.js';
import {issueAdminSessionAfterTotp} from './admin-mfa-session.js';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Trusted primary-factor login only. Load the activated factor and issue the
 * session inside the SAME transaction, locking the factor against concurrent
 * revocation. The bearer is returned only after a successful COMMIT.
 * No browser-provided primary assertions or encryption keys are permitted.
 */
export async function loginAdminWithProvisionedTotp(
 pool:Pick<Pool,'connect'>,
 primary:{staffId:string;authenticatedAt:number},
 code:unknown,
 resolveKey:(version:string)=>Promise<Buffer|null>,
 sessionPepper:Buffer,
 now=Date.now(),
):Promise<{token:string;expiresAt:number}|null>{
 if(!primary||typeof primary!=='object'||Array.isArray(primary)||
    Object.getPrototypeOf(primary)!==Object.prototype||
    Object.keys(primary).length!==2||
    !Object.hasOwn(primary,'staffId')||!Object.hasOwn(primary,'authenticatedAt')||
    typeof primary.staffId!=='string'||!UUID.test(primary.staffId)||
    !Number.isSafeInteger(primary.authenticatedAt)||primary.authenticatedAt<0||
    !Number.isSafeInteger(now)||now<0||primary.authenticatedAt>now||
    now-primary.authenticatedAt>300000||
    !Buffer.isBuffer(sessionPepper)||sessionPepper.length!==32)return null;
 const client:PoolClient=await pool.connect();
 let began=false;
 let secret:Buffer|null=null;
 try{
  await client.query('BEGIN');
  began=true;
  await client.query(
   'SELECT pg_advisory_xact_lock(hashtextextended($1::text, 104729))',
   [primary.staffId],
  );
  if(await isAdminMfaLocked(client,primary.staffId,now)){
   await client.query('ROLLBACK');
   began=false;
   return null;
  }
  // A row lock ensures that disable/delete cannot race with issuance.
  const factorLock=await client.query<{staff_id:string}>(`
   SELECT factor.staff_id::text
   FROM platform_admin_totp_factors factor
   JOIN platform_admin_staff staff ON staff.id=factor.staff_id
   JOIN users usr ON usr.id=staff.user_id
   WHERE factor.staff_id=$1::uuid AND factor.activated_at IS NOT NULL
     AND factor.disabled_at IS NULL AND staff.disabled_at IS NULL
     AND usr.status='ACTIVE'
   FOR SHARE OF factor
  `,[primary.staffId]);
  if(!factorLock||!Array.isArray(factorLock.rows)||
     factorLock.rows.length!==1||
     factorLock.rows[0]?.staff_id?.toLowerCase()!==primary.staffId.toLowerCase()){
   await client.query('ROLLBACK');
   began=false;
   return null;
  }
  secret=await loadActiveAdminTotpFactor(client,primary.staffId,resolveKey);
  if(!secret){
   await client.query('ROLLBACK');
   began=false;
   return null;
  }
  const session=await issueAdminSessionAfterTotp(
   client,primary,secret,code,sessionPepper,now,
  );
  if(!session){
   await recordAdminMfaFailure(client,primary.staffId,now);
   await client.query('COMMIT');
   began=false;
   return null;
  }
  // Clear failures after a verified second factor, in the same transaction.
  // A later failure must begin a fresh lockout window.
  await client.query(`
   DELETE FROM platform_admin_mfa_attempts WHERE staff_id=$1::uuid
  `,[primary.staffId]);
  await client.query('COMMIT');
  began=false;
  return session;
 }catch(error){
  if(began){
   try{await client.query('ROLLBACK');}catch{/* preserve original error */}
  }
  throw error;
 }finally{
  secret?.fill(0);
  client.release();
 }
}
