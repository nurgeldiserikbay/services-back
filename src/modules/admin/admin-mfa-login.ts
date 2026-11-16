import type {Pool,PoolClient} from 'pg';
import {loadActiveAdminTotpFactor} from './admin-totp-factor-store.js';
import {isAdminMfaLocked,recordAdminMfaFailure} from './admin-mfa-attempts.js';
import {issueAdminSessionAfterTotp} from './admin-mfa-session.js';
import {recordAdminMfaSecurityEvent} from './admin-mfa-security-audit.js';
import {resolveRecentAdminPrimaryAccountProof} from './admin-primary-account-proof.js';

export type AccountPrimaryInput=Readonly<{accountBearer:unknown;accountPepper:Buffer}>;

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Trusted primary-factor login only. Load the activated factor and issue the
 * session inside the SAME transaction, locking the factor against concurrent
 * revocation. The bearer is returned only after a successful COMMIT.
 * No browser-provided primary assertions or encryption keys are permitted.
 */
export async function loginAdminWithProvisionedTotp(
 pool:Pick<Pool,'connect'>,
 primary:{staffId:string;authenticatedAt:number}|AccountPrimaryInput,
 code:unknown,
 resolveKey:(version:string)=>Promise<Buffer|null>,
 sessionPepper:Buffer,
 now=Date.now(),
):Promise<{token:string;expiresAt:number}|null>{
 const fromAccount=primary!==null&&typeof primary==='object'&&
    !Array.isArray(primary)&&Object.getPrototypeOf(primary)===Object.prototype&&
    (Object.hasOwn(primary,'accountBearer')||Object.hasOwn(primary,'accountPepper'));
 const account=fromAccount?primary as AccountPrimaryInput:null;
 const attested=fromAccount?null:primary as {staffId:string;authenticatedAt:number};
 if(!pool||typeof pool.connect!=='function'||
    !primary||typeof primary!=='object'||Array.isArray(primary)||
    Object.getPrototypeOf(primary)!==Object.prototype||
    Object.keys(primary).length!==2||
    (account?(!Object.hasOwn(account,'accountBearer')||
      !Object.hasOwn(account,'accountPepper')||
      !Buffer.isBuffer(account.accountPepper)||account.accountPepper.length!==32||
      typeof account.accountBearer!=='string'||
      !/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(account.accountBearer)):
     (!attested||!Object.hasOwn(attested,'staffId')||
      !Object.hasOwn(attested,'authenticatedAt')||
      typeof attested.staffId!=='string'||!UUID.test(attested.staffId)||
      !Number.isSafeInteger(attested.authenticatedAt)||attested.authenticatedAt<0||
      attested.authenticatedAt>now||now-attested.authenticatedAt>300000))||
    !Number.isSafeInteger(now)||now<0||
    now>8640000000000000-15*60*1000||
    typeof resolveKey!=='function'||
    !Buffer.isBuffer(sessionPepper)||sessionPepper.length!==32||
    (account&&sessionPepper.equals(account.accountPepper)))return null;
 const client:PoolClient=await pool.connect();
 let began=false;
 let discardConnection=false;
 let commitAttempted=false;
 let secret:Buffer|null=null;
 try{
  try{await client.query('BEGIN');}
  catch(error){discardConnection=true;throw error;}
  began=true;
  // Bound waits and statements on this privileged transaction.
  await client.query("SET LOCAL lock_timeout = '3s'");
  await client.query("SET LOCAL statement_timeout = '8s'");
  // Resolve account proof inside this SAME transaction, before MFA locks.
  // No browser-selected staff identity or timestamp is accepted.
  const verifiedPrimary=account?
   await resolveRecentAdminPrimaryAccountProof(
    client,account.accountBearer,account.accountPepper,now):attested;
  if(!verifiedPrimary){
   try{await client.query('ROLLBACK');}
   catch(error){discardConnection=true;throw error;}
   began=false;
   return null;
  }
  await client.query(
   'SELECT pg_advisory_xact_lock(hashtextextended($1::text, 104729))',
   [verifiedPrimary.staffId],
  );
  if(await isAdminMfaLocked(client,verifiedPrimary.staffId,now)){
   try{await client.query('ROLLBACK');}
   catch(error){discardConnection=true;throw error;}
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
     AND staff.role IN ('owner','admin','operator','auditor')
     AND EXISTS (SELECT 1 FROM platform_admin_grants grants
       WHERE grants.staff_id=staff.id)
   FOR SHARE OF factor
  `,[verifiedPrimary.staffId]);
  if(!factorLock||!Array.isArray(factorLock.rows)||
     factorLock.rows.length!==1||
     typeof factorLock.rows[0]?.staff_id!=='string'||
     factorLock.rows[0].staff_id.toLowerCase()!==verifiedPrimary.staffId.toLowerCase()){
   try{await client.query('ROLLBACK');}
   catch(error){discardConnection=true;throw error;}
   began=false;
   return null;
  }
  secret=await loadActiveAdminTotpFactor(client,verifiedPrimary.staffId,resolveKey);
  if(!secret){
   try{await client.query('ROLLBACK');}
   catch(error){discardConnection=true;throw error;}
   began=false;
   return null;
  }
  const session=await issueAdminSessionAfterTotp(
   client,verifiedPrimary,secret,code,sessionPepper,now,
  );
  if(!session){
   const failure=await recordAdminMfaFailure(client,verifiedPrimary.staffId,now);
   // A verified active factor must have a durable attempt row. Never
   // acknowledge a failed login if its lockout state was not persisted.
   if(!failure)throw new Error('admin_mfa_failure_record_missing');
   await recordAdminMfaSecurityEvent(client,verifiedPrimary.staffId,'admin_mfa_login_failed');
   commitAttempted=true;
   try{await client.query('COMMIT');}
   catch(error){discardConnection=true;throw error;}
   began=false;
   return null;
  }
  // Clear failures after a verified second factor, in the same transaction.
  // A later failure must begin a fresh lockout window.
  await client.query(`
   DELETE FROM platform_admin_mfa_attempts WHERE staff_id=$1::uuid
  `,[verifiedPrimary.staffId]);
  await recordAdminMfaSecurityEvent(client,verifiedPrimary.staffId,'admin_mfa_login_succeeded');
  try{await client.query('COMMIT');}
  catch(error){discardConnection=true;throw error;}
  began=false;
  return session;
 }catch(error){
  if(began&&!commitAttempted){
   try{await client.query('ROLLBACK');}
   catch{discardConnection=true;}
  }
  throw error;
 }finally{
  secret?.fill(0);
  if(discardConnection)client.release(new Error('Admin MFA transaction outcome uncertain'));
  else client.release();
 }
}
