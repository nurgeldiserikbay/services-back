import {createDecipheriv,createHmac,randomUUID,timingSafeEqual}
  from 'node:crypto';
import type {PoolClient} from 'pg';
import {normalizeGuestContact} from '../guest-requests/guest-request.security.js';
import {consumeAccountOtpChallenge} from './account-otp-verification.js';
import {issueSessionToken} from './session-proof.js';
import type {AccountOtpChannel} from './account-otp-proof.js';

export const ACCOUNT_SIGN_IN_SESSION_TTL_SECONDS=43200;
type Db=Pick<PoolClient,'query'>;
type Secrets=Readonly<{
  otpPepper:Buffer;contactPepper:Buffer;contactKey:Buffer;sessionPepper:Buffer;
}>;
export type PrivateAccountSignIn=Readonly<{
  userId:string;sessionId:string;sessionToken:string;expiresInSeconds:number;
}>;

/**
 * Internal, caller-owned TRANSACTION. An OTP by itself is not an account.
 * This method accepts no user ID or client-selected session family.
 *
 * Failure after a correct OTP intentionally returns null, NOT an exception:
 * the surrounding transaction must COMMIT consumed_at even when no ACTIVE
 * user matches. This prevents challenge replay / account enumeration.
 */
export async function signInWithVerifiedAccountOtp(
  db:Db,input:{challengeId:unknown;channel:AccountOtpChannel;code:unknown},
  keys:Secrets,
):Promise<PrivateAccountSignIn|null>{
  const buffers=[keys.otpPepper,keys.contactPepper,keys.contactKey,keys.sessionPepper];
  if(buffers.some(k=>!Buffer.isBuffer(k)||k.length!==32)||
     buffers.some((k,i)=>buffers.some((other,j)=>j>i&&timingSafeEqual(k,other))))
    throw new Error('account_sign_in_secrets_unavailable');

  const receipt=await consumeAccountOtpChallenge(
    db,input.challengeId,'SIGN_IN',input.channel,input.code,keys.otpPepper);
  if(!receipt)return null;
  const data=await db.query<{contact_cipher:string}>(`
    SELECT contact_cipher FROM account_auth_challenges
    WHERE id=$1::uuid AND consumed_at IS NOT NULL
  `,[receipt.challengeId]);
  const encrypted=data.rows[0]?.contact_cipher;
  if(typeof encrypted!=='string')return null;
  let contact:string;
  try{
    const parts=encrypted.split('.');
    if(parts.length!==4||parts[0]!=='v1')return null;
    const iv=Buffer.from(parts[1],'base64url');
    const tag=Buffer.from(parts[2],'base64url');
    const ciphertext=Buffer.from(parts[3],'base64url');
    if(iv.length!==12||tag.length!==16||ciphertext.length<1)return null;
    const decipher=createDecipheriv('aes-256-gcm',keys.contactKey,iv);
    decipher.setAAD(Buffer.from('services-account-contact:v1'));
    decipher.setAuthTag(tag);
    contact=Buffer.concat([decipher.update(ciphertext),decipher.final()])
      .toString('utf8');
    // Authenticated ciphertext must still be normalized exactly as issuance.
    const normal=normalizeGuestContact(
      input.channel==='EMAIL'?'email':'sms',contact);
    if(normal!==contact)return null;
  }catch{return null;}

  const digest=createHmac('sha256',keys.contactPepper)
    .update('services-account-contact:v1\0').update(input.channel)
    .update('\0').update(contact).digest('hex');
  if(!timingSafeEqual(Buffer.from(digest,'hex'),
      Buffer.from(receipt.contactDigest,'hex')))return null;

  // Contact is verified by this SIGN_IN challenge, but the User itself must
  // be ACTIVE. No implicit signup, guest promotion, or case-insensitive
  // contact guessing. Signup/contact normalization require separate policy.
  const field=input.channel==='EMAIL'?'email':'phone';
  const matched=await db.query<{id:string}>(`
    SELECT id::text FROM users
    WHERE "${field}"=$1 AND status='ACTIVE'
    FOR SHARE
  `,[contact]);
  const userId=matched.rows[0]?.id;
  if(!userId)return null;

  const sessionId=randomUUID(),familyId=randomUUID();
  const proof=issueSessionToken(keys.sessionPepper);
  await db.query(`
    INSERT INTO sessions
      (id,user_id,token_hash,family_id,expires_at)
    VALUES($1::uuid,$2::uuid,$3,$4::uuid,
      now()+($5::integer*interval '1 second'))
  `,[sessionId,userId,proof.hash,familyId,ACCOUNT_SIGN_IN_SESSION_TTL_SECONDS]);
  // PRIVATE: only the trusted web BFF/native boundary may receive this token.
  return {userId,sessionId,sessionToken:proof.token,
    expiresInSeconds:ACCOUNT_SIGN_IN_SESSION_TTL_SECONDS};
}
