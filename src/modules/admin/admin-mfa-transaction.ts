import type {Pool,PoolClient} from 'pg';
import {issueAdminSessionAfterTotp} from './admin-mfa-session.js';
import {isAdminMfaLocked,recordAdminMfaFailure} from './admin-mfa-attempts.js';
import {recordAdminMfaSecurityEvent} from './admin-mfa-security-audit.js';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Transaction boundary for a trusted MFA login service.
 * Only return the privileged bearer after PostgreSQL confirms COMMIT.
 * This is deliberately NOT an HTTP endpoint or primary-factor verifier.
 */
export async function issueAdminSessionInTransaction(
 pool:Pick<Pool,'connect'>,
 primary:{staffId:string;authenticatedAt:number},
 totpSecret:Buffer,
 totpCode:unknown,
 pepper:Buffer,
 now=Date.now(),
):Promise<{token:string;expiresAt:number}|null>{
 if(!primary||typeof primary!=='object'||Array.isArray(primary)||
    Object.getPrototypeOf(primary)!==Object.prototype||
    Object.keys(primary).length!==2||
    !Object.hasOwn(primary,'staffId')||
    !Object.hasOwn(primary,'authenticatedAt')||
    typeof primary.staffId!=='string'||!UUID.test(primary.staffId)||
    !Number.isSafeInteger(primary.authenticatedAt)||primary.authenticatedAt<0||
    !Number.isSafeInteger(now)||now<0||primary.authenticatedAt>now||
    now-primary.authenticatedAt>300000||
    now>Number.MAX_SAFE_INTEGER-15*60*1000||
    !Buffer.isBuffer(totpSecret)||totpSecret.length<20||totpSecret.length>128||
    !Buffer.isBuffer(pepper)||pepper.length!==32)return null;
 const client:PoolClient=await pool.connect();
 let committed=false;
 let began=false;
 try{
  await client.query('BEGIN');
  began=true;
  // Serialize concurrent attempts for this staff identity, including the
  // first attempt before a lockout row exists. The lock is transaction-scoped.
  await client.query(
   'SELECT pg_advisory_xact_lock(hashtextextended($1::text, 104729))',
   [primary.staffId],
  );
  if(await isAdminMfaLocked(client,primary.staffId,now)){
   await client.query('ROLLBACK');
   began=false;
   return null;
  }
  // The raw-secret compatibility path must not bypass factor revocation.
  // Lock the activated factor until session issuance commits.
  const factor=await client.query<{staff_id:string}>(`
   SELECT factor.staff_id::text FROM platform_admin_totp_factors factor
   JOIN platform_admin_staff staff ON staff.id=factor.staff_id
   JOIN users usr ON usr.id=staff.user_id
   WHERE factor.staff_id=$1::uuid AND factor.activated_at IS NOT NULL
     AND factor.disabled_at IS NULL AND staff.disabled_at IS NULL
     AND usr.status='ACTIVE'
     AND EXISTS (SELECT 1 FROM platform_admin_grants grants
       WHERE grants.staff_id=staff.id)
   FOR SHARE OF factor
  `,[primary.staffId]);
  if(!factor||!Array.isArray(factor.rows)||factor.rows.length!==1||
     factor.rows[0]?.staff_id?.toLowerCase()!==primary.staffId.toLowerCase()){
   await client.query('ROLLBACK');began=false;return null;
  }
  const session=await issueAdminSessionAfterTotp(
   client,primary,totpSecret,totpCode,pepper,now,
  );
  if(!session){
   // Commit the failure independently of session issuance. Otherwise a
   // ROLLBACK would discard the lockout counter and permit unlimited guesses.
   // Invalid primary identities never produce a valid staff row in the upsert.
   await recordAdminMfaFailure(client,primary.staffId,now);
   await recordAdminMfaSecurityEvent(client,primary.staffId,'admin_mfa_login_failed');
   await client.query('COMMIT');
   committed=true;
   began=false;
   return null;
  }
  // A verified login starts a fresh failure window, consistently with the
  // provisioned-factor login path. Keep reset atomic with session issuance.
  await client.query(
   'DELETE FROM platform_admin_mfa_attempts WHERE staff_id=$1::uuid',
   [primary.staffId],
  );
  await recordAdminMfaSecurityEvent(client,primary.staffId,'admin_mfa_login_succeeded');
  await client.query('COMMIT');
  committed=true;
  began=false;
  return session;
 }catch(error){
  if(began&&!committed){
   try{await client.query('ROLLBACK');}catch{/* retain original failure */}
  }
  throw error;
 }finally{
  client.release();
 }
}
