import type {PoolClient} from 'pg';

const HASH=/^[0-9a-f]{64}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type Row={id:unknown;expires_at:unknown;revoked_at:unknown};
type Db=Pick<PoolClient,'query'>;

/**
 * Prepared PostgreSQL boundary for a FUTURE, separate browser-session table.
 * No migration or runtime registration is included in this helper.
 * Never store the browser proof; the caller must pass a domain-separated HMAC.
 * The DB's clock is authoritative for active session filtering.
 */
export function createAppealBffPgSessionStorage(db:Db){
 return {
  async findSessionByHash(hash:unknown):Promise<{
   sessionId:string;expiresAt:number;revokedAt:number|null;
  }|null>{
   if(!db||typeof db.query!=='function'||typeof hash!=='string'||!HASH.test(hash))
    return null;
   const result=await db.query<Row>(`
    SELECT browser.id::text AS id,browser.expires_at,browser.revoked_at
    FROM platform_admin_appeal_browser_sessions AS browser
    JOIN platform_admin_sessions AS parent ON parent.id=browser.admin_session_id
    JOIN platform_admin_staff AS staff ON staff.id=browser.staff_id
      AND staff.id=parent.staff_id
    JOIN users AS usr ON usr.id=staff.user_id
    WHERE browser.token_hash=$1 AND browser.revoked_at IS NULL
      AND browser.expires_at>now() AND parent.revoked_at IS NULL
      AND parent.expires_at>now() AND staff.disabled_at IS NULL
      AND usr.status='ACTIVE'
    LIMIT 2
   `,[hash]);
   if(!result||!Array.isArray(result.rows)||result.rows.length!==1)return null;
   const row=result.rows[0];
   if(!row||typeof row.id!=='string'||!UUID.test(row.id)||
    !(row.expires_at instanceof Date)||!Number.isSafeInteger(row.expires_at.getTime())||
    row.revoked_at!==null)return null;
   return {sessionId:row.id,expiresAt:row.expires_at.getTime(),revokedAt:null};
  },
  /** A single conditional UPDATE; only a committed caller may report success. */
  async revokeSessionByHash(hash:unknown):Promise<boolean>{
   if(!db||typeof db.query!=='function'||typeof hash!=='string'||!HASH.test(hash))
    return false;
   const result=await db.query<{id:string}>(`
    UPDATE platform_admin_appeal_browser_sessions
    SET revoked_at=now()
    WHERE token_hash=$1 AND revoked_at IS NULL AND expires_at>now()
    RETURNING id::text AS id
   `,[hash]);
   return !!result&&Array.isArray(result.rows)&&result.rows.length===1&&
    typeof result.rows[0]?.id==='string'&&UUID.test(result.rows[0].id);
  },
 };
}
