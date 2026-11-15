import type {Pool} from 'pg';
import {loginAdminWithProvisionedTotp} from './admin-mfa-login.js';

type KeyResolver=(version:string)=>Promise<Buffer|null>;
type LoginDeps=Readonly<{
 pool:Pick<Pool,'connect'>;
 accountSessionPepper:Buffer;
 adminSessionPepper:Buffer;
 resolveTotpKey:KeyResolver;
}>;

/**
 * Internal trusted-server integration: account bearer comes from a verified
 * account sign-in channel, never a browser-supplied staff identity. Do not
 * register this primitive as a public HTTP controller.
 *
 * Secrets are injected from the deployment's secret manager, not the request.
 * Only the committed admin session bearer may be returned to a trusted BFF.
 * TOTP format validation belongs to the transaction so malformed attempts
 * count toward the durable MFA lockout rather than bypassing rate limits.
 */
export async function loginAdminWithRecentAccountSession(
 deps:LoginDeps,
 accountBearer:unknown,
 totpCode:unknown,
 now=Date.now(),
):Promise<{token:string;expiresAt:number}|null>{
 if(!deps||typeof deps!=='object'||
    !deps.pool||typeof deps.pool.connect!=='function'||
    !Buffer.isBuffer(deps.accountSessionPepper)||
    deps.accountSessionPepper.length!==32||
    !Buffer.isBuffer(deps.adminSessionPepper)||
    deps.adminSessionPepper.length!==32||
    deps.accountSessionPepper.equals(deps.adminSessionPepper)||
    typeof deps.resolveTotpKey!=='function'||
    typeof accountBearer!=='string'||
    !/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(accountBearer)||
    !Number.isSafeInteger(now)||now<0)return null;
 return loginAdminWithProvisionedTotp(
  deps.pool,
  {accountBearer,accountPepper:deps.accountSessionPepper},
  totpCode,deps.resolveTotpKey,deps.adminSessionPepper,now,
 );
}
