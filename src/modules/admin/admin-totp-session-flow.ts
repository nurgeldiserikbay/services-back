import type {PoolClient} from 'pg';
import {verifyAdminTotp} from './admin-totp-verify.js';
import {issueReplayProtectedAdminSession} from './admin-session-replay-issuance.js';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Internal-only continuation of a successfully authenticated primary login.
 * The staff ID and decrypted TOTP secret MUST come from trusted server-side
 * identity/factor storage, never from an HTTP request or browser assertion.
 * A failed OTP must be recorded by the caller's independent durable MFA
 * attempt limiter; this helper does not implement lockout accounting.
 */
export async function verifyTotpAndIssueAdminSession(
 transaction:<T>(work:(db:Pick<PoolClient,'query'>)=>Promise<T>)=>Promise<T>,
 authenticated:{staffId:string;secret:Buffer},
 code:unknown,
 pepper:Buffer,
 now=Date.now(),
):Promise<{token:string;expiresAt:number}|null>{
 if(!authenticated||typeof authenticated!=='object'||
    Array.isArray(authenticated)||
    Object.getPrototypeOf(authenticated)!==Object.prototype||
    Object.keys(authenticated).length!==2||
    !Object.hasOwn(authenticated,'staffId')||
    !Object.hasOwn(authenticated,'secret')||
    typeof authenticated.staffId!=='string'||
    !UUID.test(authenticated.staffId))return null;
 const counter=verifyAdminTotp(authenticated.secret,code,now);
 if(counter===null)return null;
 return issueReplayProtectedAdminSession(
  transaction,
  {staffId:authenticated.staffId,mfaVerifiedAt:now,totpCounter:counter},
  pepper,now,
 );
}
