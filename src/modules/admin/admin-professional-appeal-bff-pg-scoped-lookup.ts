import type {PoolClient} from 'pg';

const HASH=/^[0-9a-f]{64}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SCOPE=/^[a-z][a-z0-9_-]{0,31}:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type Row={id:unknown;expires_at:unknown};
type Db=Pick<PoolClient,'query'>;

/**
 * Prepared, UNREGISTERED scoped browser-session lookup for privileged BFF
 * requests. The resource scope MUST be selected by trusted server-side
 * routing/authorization, never accepted as authority from a browser payload.
 * This is a read boundary, NOT a substitute for in-transaction action
 * authorization or revocation/race handling in the final mutation executor.
 */
export function createAppealBffPgScopedSessionLookup(db:Db){
 return async(tokenHash:unknown,resourceScope:unknown):Promise<{
  sessionId:string;expiresAt:number;revokedAt:null;
 }|null>=>{
  if(!db||typeof db.query!=='function'||typeof tokenHash!=='string'||
   !HASH.test(tokenHash)||typeof resourceScope!=='string'||!SCOPE.test(resourceScope))
   return null;
  const result=await db.query<Row>(`
   SELECT browser.id::text AS id,browser.expires_at
   FROM platform_admin_appeal_browser_sessions AS browser
   JOIN platform_admin_sessions AS parent ON parent.id=browser.admin_session_id
   JOIN platform_admin_staff AS staff ON staff.id=parent.staff_id
     AND staff.id=browser.staff_id
   JOIN users AS usr ON usr.id=staff.user_id
   WHERE browser.token_hash=$1 AND browser.revoked_at IS NULL
     AND browser.expires_at>now() AND parent.revoked_at IS NULL
     AND parent.created_at<=now() AND parent.expires_at>now()
     AND parent.expires_at>=browser.expires_at
     AND parent.expires_at>parent.mfa_verified_at
     AND parent.mfa_verified_at<=now()
     AND parent.mfa_verified_at>=now()-interval '15 minutes'
     AND staff.disabled_at IS NULL AND staff.role IN ('owner','admin')
     AND usr.status='ACTIVE'
     AND EXISTS (
       SELECT 1 FROM platform_admin_totp_factors factor
       WHERE factor.staff_id=staff.id
         AND factor.activated_at IS NOT NULL
         AND factor.activated_at<=parent.mfa_verified_at
         AND factor.disabled_at IS NULL
     )
     AND EXISTS (
       SELECT 1 FROM platform_admin_grants scoped_grant
       WHERE scoped_grant.staff_id=staff.id AND scoped_grant.scope=$2
     )
   LIMIT 2
  `,[tokenHash,resourceScope]);
  if(!result||!Array.isArray(result.rows)||result.rows.length!==1)return null;
  const row=result.rows[0];
  if(!row||typeof row.id!=='string'||!UUID.test(row.id)||
   !(row.expires_at instanceof Date))return null;
  const expiresAt=row.expires_at.getTime();
  if(!Number.isSafeInteger(expiresAt)||expiresAt<=Date.now())return null;
  return {sessionId:row.id,expiresAt,revokedAt:null};
 };
}
