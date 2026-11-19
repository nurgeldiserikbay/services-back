import {UnauthorizedException} from '@nestjs/common';
import {isTrustedAppealBffOrigin} from './admin-professional-appeal-bff-origin.js';
import {createHash} from 'node:crypto';
import {assertAppealBffCsrf,type AppealBffMutation} from './admin-professional-appeal-bff-csrf.js';
import {extractAdminBearerToken} from './admin-bearer-proof.js';

type BrowserRequest={
 action:AppealBffMutation; appealId:unknown; body:unknown;
 method:unknown; requestOrigin:unknown; fetchSite:unknown;
 contentType:unknown; csrfToken:unknown; sessionCookie:unknown;
 // The server's configured, exact HTTPS origin; NEVER derive this from
 // request Host, X-Forwarded-Host, Origin or untrusted proxy headers.
 expectedOrigin:string;
 csrfKey:Buffer; now?:number;
};
export type VerifiedAppealBffSession=Readonly<{
 sessionId:string;
 // This bearer comes exclusively from the trusted server-side session
 // resolver. Never read it from browser input or return it in the response.
 adminBearer:string;
}>;
type Dependencies<T>={
 /** Must validate signed/opaque cookie, session expiry and revocation at source. */
 resolveSession:(cookie:string)=>Promise<VerifiedAppealBffSession|null>;
 /** Server-side operation; must recheck admin MFA, scoped grant and assignment. */
 execute:(action:AppealBffMutation,bearer:string,appealId:string,body:unknown)=>Promise<T>;
 /** Atomically claim the proof once (e.g. unique-key INSERT in shared Redis/DB).
  * Must fail closed if unavailable; use expiresAt solely for bounded cleanup.
  * Return true only for the first claimant across all BFF workers. */
 claimCsrfProof:(sessionId:string,proofDigest:string,expiresAt:number)=>Promise<boolean>;
};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Prepared, unregistered BFF mutation coordinator. This does not implement
 * session issuance/lookup, cookie handling, HTTP routing or upstream credentials.
 * All such dependencies must be supplied by a reviewed server-only adapter.
 * No request-supplied bearer, role, grant, staff ID or session ID is trusted.
 */
export async function executeAppealBffMutation<T>(
 request:BrowserRequest,deps:Dependencies<T>,
):Promise<T>{
 const deny=()=>{throw new UnauthorizedException('Authentication required');};
 if(!request||!deps||typeof deps.resolveSession!=='function'||
  typeof deps.execute!=='function'||typeof deps.claimCsrfProof!=='function'||
  typeof request.appealId!=='string'||
  !UUID.test(request.appealId)||typeof request.sessionCookie!=='string'||
  request.sessionCookie.length<16||request.sessionCookie.length>512||
  !/^[A-Za-z0-9_-]+$/.test(request.sessionCookie)||
  !['assignment','decision'].includes(request.action)||
  request.method!=='POST'||!isTrustedAppealBffOrigin(request.expectedOrigin)||
  request.requestOrigin!==request.expectedOrigin||
  request.fetchSite!=='same-origin'||
  typeof request.csrfToken!=='string')
  return deny();
 // Resolve a live server-side session before trusting its identity.
 // This must never be a client-provided session object.
 const session=await deps.resolveSession(request.sessionCookie);
 if(!session||typeof session.sessionId!=='string'||
  !UUID.test(session.sessionId)||
  extractAdminBearerToken('Bearer '+session.adminBearer)===null)
  return deny();
 assertAppealBffCsrf({
  sessionId:session.sessionId,appealId:request.appealId,action:request.action,
  origin:request.expectedOrigin,csrfKey:request.csrfKey,method:request.method,
  requestOrigin:request.requestOrigin,fetchSite:request.fetchSite,
  contentType:request.contentType,csrfToken:request.csrfToken,
  cookieAuthenticated:true,now:request.now,
 });
 // This is a one-use mutation proof: a cryptographic signature by itself does
 // not prevent an intercepted or repeated request from executing twice.
 // Claim AFTER authentication and signature validation but BEFORE side effects.
 // Caller must implement an atomic shared-store claim, not a process-local Set.
 const issuedAt=Number(request.csrfToken.split('.')[1]);
 const proofDigest=createHash('sha256').update(request.csrfToken).digest('hex');
 const claimed=await deps.claimCsrfProof(session.sessionId,proofDigest,issuedAt+600_000);
 if(claimed!==true)return deny();
 // Redis/DB proof claiming is asynchronous. A privileged session may be
 // revoked, replaced or lose authority while that claim is in flight.
 // Re-read authoritative session state before entering the transaction-only
 // executor; it MUST also check fresh DB authority inside its transaction.
 const revalidated=await deps.resolveSession(request.sessionCookie);
 if(!revalidated||revalidated.sessionId!==session.sessionId||
  revalidated.adminBearer!==session.adminBearer||
  extractAdminBearerToken('Bearer '+revalidated.adminBearer)!==revalidated.adminBearer)
  return deny();
 // Call only a trusted server-side executor with session-bound admin proof.
 // Existing privileged DB functions remain the final authorization authority.
 return deps.execute(request.action,session.adminBearer,request.appealId,request.body);
}
