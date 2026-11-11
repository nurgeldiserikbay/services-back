import {adminSessionHashMatches} from './admin-session-token.js';

/**
 * Parse a single canonical admin bearer header. Never accept comma-joined
 * values, alternate schemes, whitespace aliases or token padding.
 * This only validates proof formatting; it does not authorize a principal.
 */
export function extractAdminBearerToken(value:unknown):string|null{
 if(typeof value!=='string'||value.length>64)return null;
 const match=/^Bearer ([A-Za-z0-9_-]{42}[AEIMQUYcgkosw048])$/.exec(value);
 return match?.[1]??null;
}

/**
 * Verify a proof against a stored admin-session hash. Callers must separately
 * enforce session expiry/revocation, MFA and per-action authorization.
 */
export function verifyAdminBearerProof(
 authorization:unknown,storedHash:unknown,pepper:Buffer,
):boolean{
 const token=extractAdminBearerToken(authorization);
 return token!==null&&adminSessionHashMatches(token,storedHash,pepper);
}
