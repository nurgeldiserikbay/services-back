import {createHmac,randomBytes} from 'node:crypto';
import {UnauthorizedException} from '@nestjs/common';
import {buildAppealBffSessionSetCookie} from './admin-professional-appeal-bff-cookie-policy.js';

const TOKEN=/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/;
const DOMAIN='services-appeal-bff-browser-session:v1\0';
const MAX_LIFETIME_MS=3_600_000;

/**
 * Prepared server-only session token domain. Do not reuse platform-admin
 * bearer, guest or account session hashing keys. No DB or HTTP wiring here.
 */
export function hashAppealBffSessionToken(token:unknown,pepper:Buffer):string{
 if(typeof token!=='string'||!TOKEN.test(token)||
  !Buffer.isBuffer(pepper)||pepper.length!==32)
  throw new UnauthorizedException('Authentication required');
 return createHmac('sha256',pepper).update(DOMAIN).update(token).digest('hex');
}

type Dependencies=Readonly<{
 /**
  * Commit an authorized session record keyed ONLY by tokenHash.
  * Must validate the privileged admin principal, recent MFA, grants, lifetime,
  * and any session limit in the SAME authoritative transaction before true.
  * Fail closed (false/throw) on authorization or uncertain commit.
  * Never persist or log the raw cookie token.
  */
 persistAuthorizedSession:(tokenHash:string,expiresAt:number)=>Promise<boolean>;
}>;

export type IssuedAppealBffBrowserSession=Readonly<{
 headers:Readonly<{
  'Set-Cookie':string;
  'Cache-Control':'no-store';
  Pragma:'no-cache';
 }>;
}>;

/** No session cookie is returned unless the authoritative write commits. */
export async function issueAppealBffBrowserSession(
 deps:Dependencies,pepper:Buffer,lifetimeSeconds:number,now=Date.now(),
):Promise<IssuedAppealBffBrowserSession>{
 const deny=():never=>{throw new UnauthorizedException('Authentication required');};
 if(!deps||typeof deps.persistAuthorizedSession!=='function'||
  !Buffer.isBuffer(pepper)||pepper.length!==32||
  !Number.isSafeInteger(lifetimeSeconds)||lifetimeSeconds<1||
  lifetimeSeconds>3600||!Number.isSafeInteger(now)||now<0||
  now>8_640_000_000_000_000-MAX_LIFETIME_MS)return deny();
 const expiresAt=now+lifetimeSeconds*1000;
 const rawToken=randomBytes(32).toString('base64url');
 const tokenHash=hashAppealBffSessionToken(rawToken,pepper);
 const committed=await deps.persistAuthorizedSession(tokenHash,expiresAt);
 if(committed!==true)return deny();
 return {headers:{
  'Set-Cookie':buildAppealBffSessionSetCookie(rawToken,lifetimeSeconds),
  'Cache-Control':'no-store',Pragma:'no-cache',
 }};
}
