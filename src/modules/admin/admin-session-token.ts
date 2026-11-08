import {createHmac,randomBytes,timingSafeEqual} from 'node:crypto';

// A 32-byte base64url token has only four valid final characters.
// Reject noncanonical aliases before hashing or comparing session proofs.
const TOKEN=/^[A-Za-z0-9_-]{42}[AQgw]$/;
const HASH=/^[0-9a-f]{64}$/;
const DOMAIN='services-platform-admin-session:v1\0';

/**
 * Platform administrator bearer tokens are cryptographically separated from
 * account and guest credentials. Never store raw tokens in database or logs.
 * This module does not authenticate a principal or expose an admin route.
 */
export function hashAdminSessionToken(token:unknown,pepper:Buffer):string{
 if(typeof token!=='string'||!TOKEN.test(token)||
  !Buffer.isBuffer(pepper)||pepper.length!==32)
  throw new Error('invalid_admin_session_proof');
 return createHmac('sha256',pepper).update(DOMAIN).update(token).digest('hex');
}

export function issueAdminSessionToken(pepper:Buffer):{token:string;tokenHash:string}{
 if(!Buffer.isBuffer(pepper)||pepper.length!==32)
  throw new Error('invalid_admin_session_secret');
 const token=randomBytes(32).toString('base64url');
 return {token,tokenHash:hashAdminSessionToken(token,pepper)};
}

/** Validation for stored hashes, not a session/revocation check. */
export function adminSessionHashMatches(
 token:unknown,storedHash:unknown,pepper:Buffer,
):boolean{
 if(typeof token!=='string'||!TOKEN.test(token)||
  typeof storedHash!=='string'||!HASH.test(storedHash)||
  !Buffer.isBuffer(pepper)||pepper.length!==32)return false;
 const computed=Buffer.from(hashAdminSessionToken(token,pepper),'hex');
 const expected=Buffer.from(storedHash,'hex');
 return timingSafeEqual(computed,expected);
}
