import type {PoolClient} from 'pg';
import {verifyAdminTotp} from './admin-totp-verify.js';
import {recordAdminMfaFailure} from './admin-mfa-attempts.js';
import {issueReplayProtectedAdminSession} from './admin-session-replay-issuance.js';

type Db=Pick<PoolClient,'query'>;
type Transaction=<T>(work:(db:Db)=>Promise<T>)=>Promise<T>;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Server-only MFA continuation. authenticated must be produced by a verified
 * primary-login flow with a decrypted active factor from trusted storage.
 * transaction must commit before returning and roll back on thrown errors.
 * Do not pass browser-supplied staff IDs or secrets into this function.
 * An independent primary-login/account-discovery rate limiter is required.
 */
export async function attemptAdminTotpLogin(
 transaction:Transaction,
 authenticated:{staffId:string;secret:Buffer},
 code:unknown,
 pepper:Buffer,
 now=Date.now(),
):Promise<{token:string;expiresAt:number}|null>{
 if(typeof transaction!=='function'||!authenticated||
    typeof authenticated!=='object'||Array.isArray(authenticated)||
    Object.getPrototypeOf(authenticated)!==Object.prototype||
    Object.keys(authenticated).length!==2||
    !Object.hasOwn(authenticated,'staffId')||
    !Object.hasOwn(authenticated,'secret')||
    typeof authenticated.staffId!=='string'||
    !UUID.test(authenticated.staffId)||
    !Buffer.isBuffer(authenticated.secret)||
    !Number.isSafeInteger(now)||now<0||
    now>8_640_000_000_000_000-900_000||
    !Buffer.isBuffer(pepper)||pepper.length!==32)return null;

 const counter=verifyAdminTotp(authenticated.secret,code,now);
 if(counter===null){
  // Persist a failure in a standalone committed transaction; never combine
  // it with a deliberately rolled-back session issuance transaction.
  const recorded=await transaction(db=>recordAdminMfaFailure(
   db,authenticated.staffId,now));
  if(recorded===null)throw new Error('admin_mfa_failure_record_missing');
  return null;
 }
 return issueReplayProtectedAdminSession(transaction,{
  staffId:authenticated.staffId,mfaVerifiedAt:now,totpCounter:counter,
 },pepper,now);
}
