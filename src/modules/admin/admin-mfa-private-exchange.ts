import type {Pool} from 'pg';
import {loginAdminWithRecentAccountSession} from './admin-mfa-account-login.js';
import {requirePrivateAdminMfaAccess} from './admin-mfa-private-auth.js';
import {parsePrivateAdminMfaRequest} from './admin-mfa-private-request.js';

type Dependencies=Readonly<{
 pool:Pick<Pool,'connect'>;
 accountSessionPepper:Buffer;
 adminSessionPepper:Buffer;
 resolveTotpKey:(version:string)=>Promise<Buffer|null>;
}>;

/**
 * Unregistered private transport adapter. The HTTP controller may use this
 * only after its DB and vault dependencies are wired and ingress restricted.
 * Access is checked first, before parsing or touching privileged resources.
 * Never log request fields or returned bearer.
 */
export async function exchangePrivateAdminMfa(
 access:unknown,
 body:unknown,
 dependencies:Dependencies,
):Promise<{session_token:string;expires_at:number}|null>{
 requirePrivateAdminMfaAccess(access);
 const parsed=parsePrivateAdminMfaRequest(body);
 if(!parsed)return null;
 const result=await loginAdminWithRecentAccountSession(
  dependencies,parsed.account_session_token,parsed.totp_code,
 );
 if(!result)return null;
 return {session_token:result.token,expires_at:result.expiresAt};
}
