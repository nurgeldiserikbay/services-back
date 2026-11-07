import {hashSessionToken,resolveActiveUserSession,
  type VerifiedUserSession} from './session-proof.js';
import type {PoolClient} from 'pg';

const TOKEN=/^[A-Za-z0-9_-]{43}$/;
export const SESSION_ACTIVITY_INTERVAL_SECONDS=300;

/**
 * Transaction-only activity recording for a verified, active account session.
 *
 * Attempt a conditional UPDATE before obtaining the fallback FOR SHARE proof
 * to avoid lock-upgrade deadlocks under concurrent requests. The UPDATE only
 * touches an eligible row once per five-minute interval, avoiding a write on
 * every read. Never renew the absolute expiry or revive a revoked session.
 *
 * Return null for unknown/revoked/expired account sessions. Bearer format and
 * secret are never derived from untrusted session IDs.
 */
export async function resolveAndTouchActiveUserSession(
  db:Pick<PoolClient,'query'>,
  opaqueToken:unknown,
  pepper:Buffer,
):Promise<VerifiedUserSession|null>{
  if(typeof opaqueToken!=='string'||!TOKEN.test(opaqueToken))return null;
  if(!Buffer.isBuffer(pepper)||pepper.length!==32)
    throw new Error('invalid_session_secret');
  const hash=hashSessionToken(opaqueToken,pepper);
  const updated=await db.query<{session_id:string;user_id:string}>(`
    UPDATE sessions AS session
       SET last_used_at=now()
      FROM users AS usr
     WHERE session.token_hash=$1
       AND session.user_id=usr.id
       AND usr.status='ACTIVE'
       AND session.revoked_at IS NULL
       AND session.expires_at>now()
       AND (session.last_used_at IS NULL
            OR session.last_used_at<now()-($2::integer*interval '1 second'))
    RETURNING session.id::text AS session_id,usr.id::text AS user_id
  `,[hash,SESSION_ACTIVITY_INTERVAL_SECONDS]);
  const touched=updated.rows[0];
  if(touched)return {userId:touched.user_id,sessionId:touched.session_id};
  // A throttled (not updated) session still needs a live authorization check.
  // Do not accept lack of an UPDATE as proof of authentication.
  return resolveActiveUserSession(db,opaqueToken,pepper);
}
