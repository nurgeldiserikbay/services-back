import type {PoolClient} from 'pg';
import {resolveActiveUserSession} from './session-proof.js';
import {resolveAndTouchActiveUserSession} from './account-session-activity.js';

type SessionDb=Pick<PoolClient,'query'>;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const ACCOUNT_SESSION_LIST_LIMIT=50;
export type AccountSessionSummary=Readonly<{
  id:string;
  deviceLabel:string|null;
  lastUsedAt:Date|null;
  expiresAt:Date;
  current:boolean;
}>;

/**
 * Internal-only: returns bounded, non-secret metadata for ACTIVE sessions
 * owned by the account identified by an existing verified bearer.
 * Never returns the token hash, token, user contact or family ID.
 * Caller owns a single PostgreSQL transaction connection.
 */
export async function listMyAccountSessions(
  db:SessionDb,opaqueToken:unknown,pepper:Buffer,
):Promise<AccountSessionSummary[]|null>{
  const actor=await resolveAndTouchActiveUserSession(db,opaqueToken,pepper);
  if(!actor)return null;
  const result=await db.query<{
    id:string;device_label:string|null;last_used_at:Date|null;expires_at:Date;
  }>(`
    SELECT id::text,device_label,last_used_at,expires_at
    FROM sessions
    WHERE user_id=$1::uuid AND revoked_at IS NULL AND expires_at>now()
    ORDER BY (id=$2::uuid) DESC,expires_at DESC,id DESC
    LIMIT $3::integer
  `,[actor.userId,actor.sessionId,ACCOUNT_SESSION_LIST_LIMIT]);
  return result.rows.map(row=>({
    id:row.id,
    deviceLabel:row.device_label,
    lastUsedAt:row.last_used_at,
    expiresAt:row.expires_at,
    current:row.id===actor.sessionId,
  }));
}

/**
 * Internal single-session logout-by-id. The target is always constrained
 * to the verified user's ownership in SQL, never trusted from client input.
 * An unknown or foreign target is indistinguishable: returns false.
 * Caller MUST use the same transaction for actor proof and mutation.
 */
export async function revokeMyAccountSessionById(
  db:SessionDb,opaqueToken:unknown,pepper:Buffer,targetId:unknown,
):Promise<boolean>{
  if(typeof targetId!=='string'||!UUID.test(targetId))return false;
  const actor=await resolveActiveUserSession(db,opaqueToken,pepper);
  if(!actor)return false;
  const updated=await db.query<{id:string}>(`
    UPDATE sessions
      SET revoked_at=now()
    WHERE id=$1::uuid AND user_id=$2::uuid
      AND revoked_at IS NULL AND expires_at>now()
    RETURNING id::text
  `,[targetId.toLowerCase(),actor.userId]);
  return updated.rows.length===1;
}
