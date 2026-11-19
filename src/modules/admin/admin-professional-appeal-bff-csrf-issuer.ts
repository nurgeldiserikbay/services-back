import {UnauthorizedException} from '@nestjs/common';
import {issueAppealBffCsrf,type AppealBffMutation} from './admin-professional-appeal-bff-csrf.js';

type Request=Readonly<{
 sessionCookie:unknown;appealId:unknown;action:unknown;
 method:unknown;requestOrigin:unknown;fetchSite:unknown;
 expectedOrigin:string;csrfKey:Buffer;now?:number;
}>;
type Dependencies=Readonly<{
 /** Must validate an opaque cookie against an active, unrevoked session. */
 resolveSession:(cookie:string)=>Promise<{sessionId:string}|null>;
}>;
export type IssuedAppealBffCsrf=Readonly<{
 token:string;headers:Readonly<{
  'Cache-Control':'no-store';Pragma:'no-cache';
  'Referrer-Policy':'no-referrer';'X-Content-Type-Options':'nosniff';
 }>;
}>;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COOKIE=/^[A-Za-z0-9_-]{16,512}$/;
/**
 * Prepared, UNREGISTERED session-bound CSRF issuer. Never derives origin from
 * Host or proxy headers, never accepts a browser-supplied session ID, and
 * never returns privileged admin bearer, session ID or signing key.
 * A deployed route must separately enforce throttling and response headers.
 */
export async function issueAppealBffCsrfForSession(
 request:Request,deps:Dependencies,
):Promise<IssuedAppealBffCsrf>{
 const deny=()=>{throw new UnauthorizedException('Authentication required');};
 if(!request||!deps||typeof deps.resolveSession!=='function'||
  request.method!=='POST'||request.requestOrigin!==request.expectedOrigin||
  request.fetchSite!=='same-origin'||
  typeof request.sessionCookie!=='string'||!COOKIE.test(request.sessionCookie)||
  typeof request.appealId!=='string'||!UUID.test(request.appealId)||
  (request.action!=='assignment'&&request.action!=='decision'))
  return deny();
 const session=await deps.resolveSession(request.sessionCookie);
 if(!session||typeof session.sessionId!=='string'||!UUID.test(session.sessionId))
  return deny();
 const token=issueAppealBffCsrf({
  sessionId:session.sessionId,appealId:request.appealId,
  action:request.action as AppealBffMutation,
  origin:request.expectedOrigin,csrfKey:request.csrfKey,
 },request.now);
 return {token,headers:{
  'Cache-Control':'no-store',Pragma:'no-cache',
  'Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff',
 }};
}
