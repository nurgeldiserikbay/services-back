import type {PoolClient} from 'pg';
import {verifyAdminTotp} from './admin-totp-verify.js';
import {issueReplayProtectedAdminSession} from './admin-session-replay-issuance.js';
import {attemptAdminTotpLogin} from './admin-totp-login-attempt.js';

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
 if(typeof transaction!=='function'||
    !Buffer.isBuffer(pepper)||pepper.length!==32||
    !Number.isSafeInteger(now)||now<0||
    now>8_640_000_000_000_000-900_000||
    !authenticated||typeof authenticated!=='object'||
    Array.isArray(authenticated)||
    Object.getPrototypeOf(authenticated)!==Object.prototype||
    Object.keys(authenticated).length!==2||
    !Object.hasOwn(authenticated,'staffId')||
    !Object.hasOwn(authenticated,'secret')||
    typeof authenticated.staffId!=='string'||
    !UUID.test(authenticated.staffId)||
    !Buffer.isBuffer(authenticated.secret)||
    authenticated.secret.length<20||authenticated.secret.length>128)return null;
 const counter=verifyAdminTotp(authenticated.secret,code,now);
 if(counter===null)return null;
 return issueReplayProtectedAdminSession(
  transaction,
  {staffId:authenticated.staffId,mfaVerifiedAt:now,totpCounter:counter},
  pepper,now,
 );
}

/**
 * Public login orchestration boundary after trusted primary authentication.
 * Invalid OTPs are persisted in a SEPARATE committed transaction, so the
 * failed-attempt record cannot be undone by session-issuance rollback.
 * The caller must additionally enforce a pre-authentication IP/account limiter.
 */
export async function verifyTotpWithDurableFailureAccounting(
 transaction:<T>(work:(db:Pick<PoolClient,'query'>)=>Promise<T>)=>Promise<T>,
 authenticated:{staffId:string;secret:Buffer},
 code:unknown,
 pepper:Buffer,
 now=Date.now(),
):Promise<{token:string;expiresAt:number}|null>{
 // Keep one authoritative failure-accounting implementation. In particular,
 // a missing attempt row must throw and roll back rather than be accepted.
 return attemptAdminTotpLogin(transaction,authenticated,code,pepper,now);
}
