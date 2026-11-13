import type {PoolClient} from 'pg';
import {verifyAdminTotp} from './admin-totp.js';
import {consumeAdminTotpCounter} from './admin-totp-replay.js';
import {createVerifiedPlatformAdminSession} from './admin-session-issuance.js';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_PRIMARY_AGE_MS=5*60*1000;

/**
 * Trusted server-only orchestration primitive. Caller MUST:
 * 1. Authenticate primary credentials and supply a server-attested staffId/time.
 * 2. Load the staff member's provisioned decrypted TOTP secret from a vault.
 * 3. Invoke inside ONE database transaction and return the bearer only AFTER COMMIT.
 * 4. Enforce rate limits and lockouts outside this primitive.
 *
 * This is not a browser endpoint and must not be exposed as one.
 */
export async function issueAdminSessionAfterTotp(
 db:Pick<PoolClient,'query'>,
 primary:{staffId:string;authenticatedAt:number},
 totpSecret:Buffer,
 totpCode:unknown,
 pepper:Buffer,
 now=Date.now(),
):Promise<{token:string;expiresAt:number}|null>{
 if(!primary||typeof primary!=='object'||Array.isArray(primary)||
    Object.getPrototypeOf(primary)!==Object.prototype||
    Object.keys(primary).length!==2||
    !Object.hasOwn(primary,'staffId')||
    !Object.hasOwn(primary,'authenticatedAt')||
    typeof primary.staffId!=='string'||!UUID.test(primary.staffId)||
    !Number.isSafeInteger(primary.authenticatedAt)||
    !Number.isSafeInteger(now)||now<0||
    primary.authenticatedAt<0||primary.authenticatedAt>now||
    now-primary.authenticatedAt>MAX_PRIMARY_AGE_MS||
    !Buffer.isBuffer(totpSecret)||totpSecret.length<20||totpSecret.length>128||
    typeof totpCode!=='string'||!/^[0-9]{6}$/.test(totpCode)||
    !Buffer.isBuffer(pepper)||pepper.length!==32)
  return null;
 // Verify against the current clock; persistent compare-and-swap below is the
 // authoritative replay guard under concurrent requests.
 const counter=verifyAdminTotp(totpSecret,totpCode,now,-1);
 if(counter===null)return null;
 if(!await consumeAdminTotpCounter(db,primary.staffId,counter))return null;
 const session=await createVerifiedPlatformAdminSession(
  db,{staffId:primary.staffId,mfaVerifiedAt:now},pepper,now,
 );
 // A consumed code without an issued session must not be committed. The
 // transaction owner must roll back when this error propagates.
 if(!session)throw new Error('admin_mfa_session_issuance_denied');
 return session;
}
