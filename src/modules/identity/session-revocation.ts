import type {PoolClient} from 'pg';
import {resolveActiveUserSession} from './session-proof.js';

type SessionDb=Pick<PoolClient,'query'>;

/**
 * Internal transaction-only logout primitive.
 * The opaque session token MUST be supplied by the authenticated server-side
 * caller, never a user ID or a browser-supplied target session ID.
 *
 * Caller MUST run this on a single transaction connection so session
 * validation and revocation form one atomic operation.
 */
export async function revokeCurrentAccountSession(
  db:SessionDb,opaqueToken:unknown,pepper:Buffer,
):Promise<boolean>{
  const actor=await resolveActiveUserSession(db,opaqueToken,pepper);
  if(!actor)return false;
  const result=await db.query<{id:string}>(`
    UPDATE sessions
       SET revoked_at=now()
     WHERE id=$1::uuid AND user_id=$2::uuid
       AND revoked_at IS NULL AND expires_at>now()
     RETURNING id::text
  `,[actor.sessionId,actor.userId]);
  return result.rows.length===1;
}

/**
 * Revokes all currently active sessions from the *authenticated session's*
 * family only. This does NOT revoke every session belonging to the user.
 *
 * Family is resolved from the verified actor session in SQL; the caller
 * cannot choose family_id, user_id or a victim session ID.
 * Caller MUST hold one transaction connection for verification + mutation.
 */
export async function revokeCurrentAccountSessionFamily(
  db:SessionDb,opaqueToken:unknown,pepper:Buffer,
):Promise<number>{
  const actor=await resolveActiveUserSession(db,opaqueToken,pepper);
  if(!actor)return 0;
  const result=await db.query<{id:string}>(`
    UPDATE sessions
       SET revoked_at=now()
     WHERE user_id=$1::uuid
       AND family_id=(
         SELECT family_id FROM sessions
          WHERE id=$2::uuid AND user_id=$1::uuid
       )
       AND revoked_at IS NULL AND expires_at>now()
     RETURNING id::text
  `,[actor.userId,actor.sessionId]);
  return result.rows.length;
}
