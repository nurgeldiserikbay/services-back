import type {PoolClient} from 'pg';
import type {AppealBffMutation} from './admin-professional-appeal-bff-csrf.js';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type Db=Pick<PoolClient,'query'>;

/**
 * Prepared, UNREGISTERED transaction boundary. The caller MUST pass an
 * exclusively owned PostgreSQL PoolClient, never a Pool.query facade.
 * All privileged mutation statements from work() MUST use the SAME client.
 * Does not register an HTTP controller or authorize case-specific outcomes.
 *
 * Lock browser proof, its EXACT parent admin session, staff/user, active TOTP,
 * explicit scope grant, appeal and case together before invoking any mutation.
 * Updates/deletions of these existing rows cannot commit during work().
 */
export async function withAppealBffPgMutationAuthority<T>(
 db:Db,sessionId:unknown,appealId:unknown,action:unknown,
 work:(client:Db)=>Promise<T>,
):Promise<T|null>{
 if(!db||typeof db.query!=='function'||typeof work!=='function'||
  typeof sessionId!=='string'||!UUID.test(sessionId)||
  typeof appealId!=='string'||!UUID.test(appealId)||
  (action!=='assignment'&&action!=='decision'))return null;
 let inTransaction=false;
 try{
  await db.query('BEGIN');
  inTransaction=true;
  const result=await db.query<{id:string}>(`
   SELECT browser.id::text AS id
   FROM platform_admin_appeal_browser_sessions browser
   JOIN platform_admin_sessions parent ON parent.id=browser.admin_session_id
     AND parent.staff_id=browser.staff_id
   JOIN platform_admin_staff staff ON staff.id=browser.staff_id
   JOIN users usr ON usr.id=staff.user_id
   JOIN platform_admin_totp_factors factor ON factor.staff_id=staff.id
   JOIN professional_moderation_appeals appeal ON appeal.id=$2::uuid
   JOIN platform_moderation_cases moderation ON moderation.id=appeal.case_id
   JOIN platform_admin_grants scoped_grant ON scoped_grant.staff_id=staff.id
     AND scoped_grant.scope=moderation.resource_scope
   WHERE browser.id=$1::uuid AND browser.revoked_at IS NULL
     AND browser.expires_at>clock_timestamp()
     AND parent.revoked_at IS NULL AND parent.created_at<=clock_timestamp()
     AND parent.expires_at>clock_timestamp()
     AND parent.expires_at>=browser.expires_at
     AND parent.mfa_verified_at<=clock_timestamp()
     AND parent.mfa_verified_at>=clock_timestamp()-interval '15 minutes'
     AND parent.mfa_verified_at<parent.expires_at
     AND staff.disabled_at IS NULL AND staff.role IN ('owner','admin')
     AND usr.status='ACTIVE'
     AND factor.activated_at IS NOT NULL
     AND factor.activated_at<=parent.mfa_verified_at
     AND factor.disabled_at IS NULL
     AND moderation.resource_scope=('professional:' || appeal.profile_id::text)
   FOR SHARE OF browser,parent,staff,usr,factor,appeal,moderation,scoped_grant
  `,[sessionId,appealId]);
  if(!result||!Array.isArray(result.rows)||result.rows.length!==1||
   result.rows[0]?.id!==sessionId){
   await db.query('ROLLBACK');
   inTransaction=false;
   return null;
  }
  // The privileged executor still validates reviewer assignment, allowed
  // transitions, request body, idempotency and audit inside THIS transaction.
  const output=await work(db);
  // Recheck TTL after potentially long DB work, before the final commit.
  const alive=await db.query<{alive:boolean}>(`
   SELECT browser.expires_at>clock_timestamp()
      AND parent.expires_at>clock_timestamp()
      AND parent.mfa_verified_at>=clock_timestamp()-interval '15 minutes'
      AS alive
   FROM platform_admin_appeal_browser_sessions browser
   JOIN platform_admin_sessions parent ON parent.id=browser.admin_session_id
   WHERE browser.id=$1::uuid AND browser.revoked_at IS NULL
     AND parent.revoked_at IS NULL
  `,[sessionId]);
  if(!alive||!Array.isArray(alive.rows)||alive.rows.length!==1||
   alive.rows[0]?.alive!==true){
   await db.query('ROLLBACK');
   inTransaction=false;
   return null;
  }
  await db.query('COMMIT');
  inTransaction=false;
  return output;
 }catch(error){
  if(inTransaction)try{await db.query('ROLLBACK');}catch{}
  throw error;
 }
}
