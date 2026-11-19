import {UnauthorizedException} from '@nestjs/common';
import {extractAppealBffSessionCookie} from './admin-professional-appeal-bff-cookie.js';
import {buildAppealBffSessionClearCookie} from './admin-professional-appeal-bff-cookie-policy.js';

type LogoutRequest=Readonly<{
 rawCookieHeader:unknown;
 method:unknown;
 requestOrigin:unknown;
 fetchSite:unknown;
 /** Exact configured HTTPS application origin, never derived from a request header. */
 expectedOrigin:string;
}>;
type Dependencies=Readonly<{
 /**
  * Authoritatively revoke the opaque browser session with a committed write
  * before returning true. Fail closed on unavailable or uncertain storage.
  * Do not interpret client-side cookie deletion as server-side revocation.
  */
 revokeSession:(opaqueCookie:string)=>Promise<boolean>;
}>;
export type AppealBffLogoutResult=Readonly<{
 headers:Readonly<{
  'Set-Cookie':string;
  'Cache-Control':'no-store';
  Pragma:'no-cache';
 }>;
}>;

/**
 * Prepared, UNREGISTERED logout coordinator.
 * Requires same-origin POST and raw unambiguous Cookie, then durable server
 * revocation BEFORE returning the browser's clear-cookie header. Revocation
 * errors propagate; a false result is denied. No Set-Cookie is issued before
 * confirmed revocation, and this does not create HTTP routes or a session DB.
 */
export async function logoutAppealBffSession(
 request:LogoutRequest,deps:Dependencies,
):Promise<AppealBffLogoutResult>{
 const deny=():never=>{throw new UnauthorizedException('Authentication required');};
 if(!request||!deps||typeof deps.revokeSession!=='function'||
  request.method!=='POST'||request.requestOrigin!==request.expectedOrigin||
  request.fetchSite!=='same-origin')return deny();
 if(typeof request.expectedOrigin!=='string'||
  !/^https:\/\/[a-z0-9.-]+(?::[0-9]{2,5})?$/i.test(request.expectedOrigin)||
  request.expectedOrigin.includes('..'))return deny();
 const opaqueCookie=extractAppealBffSessionCookie(request.rawCookieHeader);
 const revoked=await deps.revokeSession(opaqueCookie);
 if(revoked!==true)return deny();
 return {headers:{
  'Set-Cookie':buildAppealBffSessionClearCookie(),
  'Cache-Control':'no-store',Pragma:'no-cache',
 }};
}
