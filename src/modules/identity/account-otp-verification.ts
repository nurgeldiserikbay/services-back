import type {PoolClient} from 'pg';
import {
  ACCOUNT_OTP_MAX_ATTEMPTS,verifyAccountOtp,
  type AccountOtpChannel,type AccountOtpPurpose,
} from './account-otp-proof.js';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type ChallengeRow={
  id:string;channel:AccountOtpChannel;purpose:AccountOtpPurpose;
  contact_digest:string;code_hash:string;attempts:number;
  expires_at:Date;consumed_at:Date|null;
};
export type VerifiedAccountContact=Readonly<{
  challengeId:string;channel:AccountOtpChannel;
  purpose:AccountOtpPurpose;contactDigest:string;
}>;
/**
 * TRANSACTION-ONLY verification. Always returns null on invalid/replayed
 * challenges; the failed-attempt increment must COMMIT even on a bad code.
 * Caller is responsible for one transaction client and never throwing a
 * rollback-triggering auth exception before committing failed attempts.
 *
 * This proof does not establish that a User exists, is ACTIVE, or has agreed
 * to signup terms. It must never directly issue an account session.
 */
export async function consumeAccountOtpChallenge(
  db:Pick<PoolClient,'query'>,challengeId:unknown,
  purpose:AccountOtpPurpose,channel:AccountOtpChannel,
  candidate:unknown,pepper:Buffer,
):Promise<VerifiedAccountContact|null>{
  if(typeof challengeId!=='string'||!UUID.test(challengeId)||
     !['SIGN_IN','SIGN_UP'].includes(purpose)||
     !['EMAIL','SMS'].includes(channel)||
     typeof candidate!=='string'||!/^[0-9]{6}$/.test(candidate))return null;
  if(!Buffer.isBuffer(pepper)||pepper.length!==32)
    throw new Error('account_otp_secret_unavailable');
  const response=await db.query<ChallengeRow>(`
    SELECT id::text,channel::text,purpose::text,contact_digest,
      code_hash,attempts,expires_at,consumed_at
    FROM account_auth_challenges
    WHERE id=$1::uuid FOR UPDATE
  `,[challengeId.toLowerCase()]);
  const row=response.rows[0];
  if(!row||row.channel!==channel||row.purpose!==purpose||
     row.consumed_at!==null||!Number.isSafeInteger(row.attempts)||
     row.attempts<0||row.attempts>=ACCOUNT_OTP_MAX_ATTEMPTS||
     !(row.expires_at instanceof Date)||row.expires_at.getTime()<=Date.now())return null;

  // Count every actual verification attempt, including a successful one.
  // A wrong code returns null so the increment can commit.
  const verified=verifyAccountOtp(row.id,purpose,candidate,row.code_hash,pepper);
  const updated=await db.query<{id:string}>(`
    UPDATE account_auth_challenges
    SET attempts=attempts+1,
      consumed_at=CASE WHEN $2::boolean THEN now() ELSE consumed_at END
    WHERE id=$1::uuid AND consumed_at IS NULL
      AND expires_at>now() AND attempts<$3::integer
    RETURNING id::text
  `,[row.id,verified,ACCOUNT_OTP_MAX_ATTEMPTS]);
  if(!verified||updated.rows.length!==1)return null;
  return {challengeId:row.id,channel,purpose,contactDigest:row.contact_digest};
}
