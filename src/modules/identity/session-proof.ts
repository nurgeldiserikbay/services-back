import {createHmac,randomBytes} from 'node:crypto';
import type {PoolClient} from 'pg';

// 32 random bytes encode to 43 base64url characters; the final digit has two zero padding bits.
// Reject alternate textual encodings of the same bearer proof.
const TOKEN=/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Compatible only with sessions issued using this exact v1 scheme. */
export function hashSessionToken(token:string,pepper:Buffer):string{
  if(typeof token!=='string'||!TOKEN.test(token)||
     !Buffer.isBuffer(pepper)||pepper.length!==32)
    throw new Error('invalid_session_proof');
  return createHmac('sha256',pepper).update('services-session:v1\0').update(token).digest('hex');
}
export function issueSessionToken(pepper:Buffer):{token:string;hash:string}{
  if(!Buffer.isBuffer(pepper)||pepper.length!==32)
    throw new Error('invalid_session_secret');
  const token=randomBytes(32).toString('base64url');
  return {token,hash:hashSessionToken(token,pepper)};
}

export type VerifiedUserSession={userId:string;sessionId:string};

/**
 * Internal fail-closed lookup. The token is an opaque bearer issued ONLY after
 * a separate verified account-login flow. No session cookies parsed here and
 * no client-supplied user IDs. An unverified email/guest OTP does not grant it.
 */
export async function resolveActiveUserSession(
  db:Pick<PoolClient,'query'>,
  opaqueToken:unknown,
  pepper:Buffer,
):Promise<VerifiedUserSession|null>{
  if(typeof opaqueToken!=='string'||!TOKEN.test(opaqueToken))return null;
  if(!Buffer.isBuffer(pepper)||pepper.length!==32)
    throw new Error('invalid_session_secret');
  const tokenHash=hashSessionToken(opaqueToken,pepper);
  const rows=await db.query<{session_id:string;user_id:string}>(`
    SELECT session.id::text AS session_id,usr.id::text AS user_id
    FROM sessions session
    JOIN users usr ON usr.id=session.user_id
    WHERE session.token_hash=$1
      AND session.revoked_at IS NULL
      AND session.expires_at>now()
      AND usr.status='ACTIVE'
    FOR SHARE OF session,usr
  `,[tokenHash]);
  const record=rows.rows[0];
  if(!record||!UUID.test(record.user_id)||!UUID.test(record.session_id))return null;
  return {userId:record.user_id,sessionId:record.session_id};
}
