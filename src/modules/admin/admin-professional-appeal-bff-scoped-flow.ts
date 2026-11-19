import {createAppealBffHashSessionResolver} from './admin-professional-appeal-bff-session-resolver.js';
import type {VerifiedAppealBffSession} from './admin-professional-appeal-bff-mutation.js';
import type {AppealBffMutation} from './admin-professional-appeal-bff-csrf.js';
import {
 issueAppealBffCsrfFromRawCookie,executeAppealBffMutationFromRawCookie,
} from './admin-professional-appeal-bff-raw-cookie.js';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SCOPE=/^[a-z][a-z0-9_-]{0,31}:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type SessionRow=Readonly<{sessionId:string;expiresAt:number;revokedAt:number|null}>;
type Dependencies=Readonly<{
 /**
  * Query the appeal's authoritative DB record and determine its resource
  * scope. NEVER return an unvalidated browser-provided scope or staff ID.
  */
 resolveAppealScope:(appealId:string,action:AppealBffMutation)=>Promise<string|null>;
 /** Use createAppealBffPgScopedSessionLookup over migrated PostgreSQL. */
 lookupScopedSession:(tokenHash:string,scope:string)=>Promise<SessionRow|null>;
 /** Reauthorize and fetch a SERVER-ONLY privileged bearer, never from HTTP. */
 resolvePrivilegedBearer:(sessionId:string)=>Promise<string|null>;
}>;

/**
 * Unregistered integration of scope-from-appeal, token HMAC, live PG scoped
 * lookup and privileged authority. Every request binds scope to ITS appeal.
 * Does not expose a browser-controlled resourceScope parameter.
 */
export function createAppealBffPerAppealSessionResolver(
 deps:Dependencies,pepper:Buffer,now:()=>number=Date.now,
){
 return async(cookie:string,appealId:unknown,action:unknown):Promise<VerifiedAppealBffSession|null>=>{
  if(!deps||typeof deps.resolveAppealScope!=='function'||
   typeof deps.lookupScopedSession!=='function'||
   typeof deps.resolvePrivilegedBearer!=='function'||
   typeof appealId!=='string'||!UUID.test(appealId)||
   (action!=='assignment'&&action!=='decision'))return null;
  const scope=await deps.resolveAppealScope(appealId,action);
  if(typeof scope!=='string'||!SCOPE.test(scope))return null;
  const resolve=createAppealBffHashSessionResolver({
   findSessionByHash:(hash)=>deps.lookupScopedSession(hash,scope),
   resolvePrivilegedBearer:deps.resolvePrivilegedBearer,
  },pepper,now);
  return resolve(cookie);
 };
}

type ScopedResolver=Readonly<{
 resolveSessionForAppeal:(cookie:string,appealId:unknown,action:unknown)=>
  Promise<VerifiedAppealBffSession|null>;
}>;
type IssuanceRequest=Parameters<typeof issueAppealBffCsrfFromRawCookie>[0];
type MutationRequest=Parameters<typeof executeAppealBffMutationFromRawCookie>[0];

/** No HTTP route: wires existing strict raw Cookie + origin + CSRF layers. */
export async function issueAppealBffScopedCsrfFromRawCookie(
 request:IssuanceRequest,deps:ScopedResolver,
){
 return issueAppealBffCsrfFromRawCookie(request,{
  resolveSession:(cookie)=>deps.resolveSessionForAppeal(cookie,request.appealId,request.action),
 });
}

/**
 * No HTTP route. Executor MUST repeat action authorization inside its
 * transaction. A scoped read alone cannot prevent a concurrent grant change.
 */
export async function executeAppealBffScopedMutationFromRawCookie<T>(
 request:MutationRequest,
 deps:ScopedResolver&Readonly<{
  claimCsrfProof:(sessionId:string,digest:string,expiresAt:number)=>Promise<boolean>;
  execute:(action:AppealBffMutation,bearer:string,appealId:string,body:unknown)=>Promise<T>;
 }>,
):Promise<T>{
 return executeAppealBffMutationFromRawCookie(request,{
  resolveSession:(cookie)=>deps.resolveSessionForAppeal(cookie,request.appealId,request.action),
  claimCsrfProof:deps.claimCsrfProof,
  execute:deps.execute,
 });
}
