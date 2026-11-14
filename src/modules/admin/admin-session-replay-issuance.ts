import type {PoolClient} from 'pg';
import {consumeAdminTotpCounter} from './admin-totp-replay.js';
import {createVerifiedPlatformAdminSession} from './admin-session-issuance.js';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DENIED=Symbol('admin_session_denied');

/**
 * Trusted server-side orchestration only. The caller MUST independently
 * authenticate the principal and verify the TOTP code before calling this.
 * transaction() MUST commit before resolving, and roll back on any throw.
 * Never expose this function as an endpoint accepting browser assertions.
 */
export async function issueReplayProtectedAdminSession(
 transaction:<T>(work:(db:Pick<PoolClient,'query'>)=>Promise<T>)=>Promise<T>,
 verified:{staffId:string;mfaVerifiedAt:number;totpCounter:number},
 pepper:Buffer,
 now=Date.now(),
):Promise<{token:string;expiresAt:number}|null>{
 if(typeof transaction!=='function'||!verified||
    typeof verified!=='object'||Array.isArray(verified)||
    Object.getPrototypeOf(verified)!==Object.prototype||
    Object.keys(verified).length!==3||
    !Object.hasOwn(verified,'staffId')||
    !Object.hasOwn(verified,'mfaVerifiedAt')||
    !Object.hasOwn(verified,'totpCounter')||
    typeof verified.staffId!=='string'||!UUID.test(verified.staffId)||
    !Number.isSafeInteger(verified.totpCounter)||verified.totpCounter<0||
    !Number.isSafeInteger(verified.mfaVerifiedAt)||
    !Number.isSafeInteger(now)||now<0||
    verified.mfaVerifiedAt>now||now-verified.mfaVerifiedAt>15*60*1000||
    !Buffer.isBuffer(pepper)||pepper.length!==32)return null;
 try{
  return await transaction(async db=>{
   if(!await consumeAdminTotpCounter(db,verified.staffId,verified.totpCounter))
    throw DENIED;
   const session=await createVerifiedPlatformAdminSession(
    db,{staffId:verified.staffId,mfaVerifiedAt:verified.mfaVerifiedAt},pepper,now);
   if(!session)throw DENIED;
   return session;
  });
 }catch(error){
  if(error===DENIED)return null;
  throw error;
 }
}
