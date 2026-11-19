import {hashAppealBffSessionToken} from './admin-professional-appeal-bff-session-issuance.js';
import {extractAdminBearerToken} from './admin-bearer-proof.js';
import type {VerifiedAppealBffSession} from './admin-professional-appeal-bff-mutation.js';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type SessionRow=Readonly<{
 sessionId:string;expiresAt:number;revokedAt:number|null;
}>;
type Dependencies=Readonly<{
 /**
  * Fetch an authoritative server-side browser session by HMAC hash only.
  * The implementation must use a shared durable store, not an in-memory Map.
  * Concurrent revocation, MFA and staff status must be enforced at source.
  */
 findSessionByHash:(tokenHash:string)=>Promise<SessionRow|null>;
 /**
  * Obtain a trusted server-only admin bearer AFTER validating session state.
  * Must enforce fresh MFA, active grants and current staff authority.
  * Never accept a browser-supplied bearer or persist its plaintext with cookie.
  */
 resolvePrivilegedBearer:(sessionId:string)=>Promise<string|null>;
}>;

/**
 * Prepared, UNREGISTERED browser session resolver. Hashes an opaque cookie in
 * a distinct HMAC domain and refuses expired/revoked/malformed session rows.
 * Errors from storage propagate (fail closed); never fall back to in-memory
 * or accept browser-supplied identities.
 */
export function createAppealBffHashSessionResolver(
 dependencies:Dependencies,pepper:Buffer,now:()=>number=Date.now,
):(cookie:unknown)=>Promise<VerifiedAppealBffSession|null>{
 return async(cookie)=>{
  if(!dependencies||typeof dependencies.findSessionByHash!=='function'||
   typeof dependencies.resolvePrivilegedBearer!=='function'||
   !Buffer.isBuffer(pepper)||pepper.length!==32)return null;
  const current=now();
  if(!Number.isSafeInteger(current)||current<0||
   current>8_640_000_000_000_000)return null;
  let hash:string;
  try{hash=hashAppealBffSessionToken(cookie,pepper);}
  catch{return null;}
  const session=await dependencies.findSessionByHash(hash);
  if(!session||typeof session.sessionId!=='string'||!UUID.test(session.sessionId)||
   !Number.isSafeInteger(session.expiresAt)||session.expiresAt<=current||
   session.revokedAt!==null)return null;
  const bearer=await dependencies.resolvePrivilegedBearer(session.sessionId);
  if(typeof bearer!=='string'||
   extractAdminBearerToken('Bearer '+bearer)!==bearer)return null;
  return {sessionId:session.sessionId,adminBearer:bearer};
 };
}
