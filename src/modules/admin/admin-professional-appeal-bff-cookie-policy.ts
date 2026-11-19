import {UnauthorizedException} from '@nestjs/common';

export const APPEAL_BFF_SESSION_COOKIE='__Host-services-appeal-session';
const OPAQUE=/^[A-Za-z0-9_-]{16,512}$/;
const MAX_AGE_SECONDS=3600;

/**
 * Prepared server-only cookie response policy. This helper does not mint,
 * validate, persist or revoke sessions; it does not register any HTTP route.
 * Call only on an HTTPS origin with a server-created opaque session proof.
 */
export function buildAppealBffSessionSetCookie(
 opaqueSessionProof:unknown,maxAgeSeconds:unknown,
):string{
 const deny=():never=>{throw new UnauthorizedException('Authentication required');};
 if(typeof opaqueSessionProof!=='string'||!OPAQUE.test(opaqueSessionProof)||
  typeof maxAgeSeconds!=='number'||!Number.isSafeInteger(maxAgeSeconds)||
  maxAgeSeconds<1||maxAgeSeconds>MAX_AGE_SECONDS)return deny();
 return APPEAL_BFF_SESSION_COOKIE+'='+opaqueSessionProof+
  '; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age='+maxAgeSeconds;
}

/**
 * Expire the browser cookie. Callers must separately revoke its session in
 * the authoritative store; a Set-Cookie deletion is never server revocation.
 */
export function buildAppealBffSessionClearCookie():string{
 return APPEAL_BFF_SESSION_COOKIE+
  '=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0';
}
