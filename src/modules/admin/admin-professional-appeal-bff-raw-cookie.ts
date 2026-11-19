import {extractAppealBffSessionCookie} from './admin-professional-appeal-bff-cookie.js';
import {issueAppealBffCsrfForSession} from './admin-professional-appeal-bff-csrf-issuer.js';
import {executeAppealBffMutation,type VerifiedAppealBffSession} from './admin-professional-appeal-bff-mutation.js';
import type {AppealBffMutation} from './admin-professional-appeal-bff-csrf.js';

/** Unregistered, server-only adapters for a future raw HTTP request boundary.
 * Never use a framework's parsed cookie map, and never read browser-provided
 * session IDs, bearer tokens, scopes or CSRF signing keys.
 */
type RequestBase=Readonly<{
 rawCookieHeader:unknown;appealId:unknown;action:AppealBffMutation;
 method:unknown;requestOrigin:unknown;fetchSite:unknown;
 expectedOrigin:string;csrfKey:Buffer;now?:number;
}>;
type MutationRequest=RequestBase&Readonly<{
 body:unknown;contentType:unknown;csrfToken:unknown;
}>;
type SessionResolver=Readonly<{
 resolveSession:(cookie:string)=>Promise<VerifiedAppealBffSession|null>;
}>;
type MutationDeps<T>=SessionResolver&Readonly<{
 claimCsrfProof:(sessionId:string,digest:string,expiresAt:number)=>Promise<boolean>;
 execute:(action:AppealBffMutation,bearer:string,appealId:string,body:unknown)=>Promise<T>;
}>;

/** Resolve the raw cookie before issuing a CSRF proof. No HTTP route is registered. */
export async function issueAppealBffCsrfFromRawCookie(
 request:RequestBase,deps:SessionResolver,
){
 const sessionCookie=extractAppealBffSessionCookie(request?.rawCookieHeader);
 return issueAppealBffCsrfForSession({
  sessionCookie,appealId:request.appealId,action:request.action,
  method:request.method,requestOrigin:request.requestOrigin,
  fetchSite:request.fetchSite,expectedOrigin:request.expectedOrigin,
  csrfKey:request.csrfKey,now:request.now,
 },{resolveSession:deps.resolveSession});
}

/** Reject ambiguous raw cookie headers before any privileged session lookup. */
export async function executeAppealBffMutationFromRawCookie<T>(
 request:MutationRequest,deps:MutationDeps<T>,
):Promise<T>{
 const sessionCookie=extractAppealBffSessionCookie(request?.rawCookieHeader);
 return executeAppealBffMutation({
  sessionCookie,appealId:request.appealId,action:request.action,body:request.body,
  method:request.method,requestOrigin:request.requestOrigin,
  fetchSite:request.fetchSite,expectedOrigin:request.expectedOrigin,
  csrfKey:request.csrfKey,now:request.now,contentType:request.contentType,
  csrfToken:request.csrfToken,
 },deps);
}
