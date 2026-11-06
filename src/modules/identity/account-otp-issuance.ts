import {createCipheriv,createHmac,randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';
import type {PoolClient} from 'pg';
import {normalizeGuestContact,requireSecret} from '../guest-requests/guest-request.security.js';
import {checkAccountOtpGlobalBudget} from './account-otp-global-budget.js';
import {ACCOUNT_OTP_TTL_SECONDS,generateAccountOtp,
  type AccountOtpChannel,type AccountOtpPurpose} from './account-otp-proof.js';

export class AccountOtpIssuanceUnavailable extends Error {
  constructor(){super('Account challenge temporarily unavailable');}
}
export type PrivateAccountOtpDispatch=Readonly<{
  challengeId:string;channel:AccountOtpChannel;purpose:AccountOtpPurpose;
  destination:string;code:string;expiresInSeconds:number;
}>;

/**
 * Internal-only issuance. No HTTP controller, no delivery, no session token.
 * A separate approved anti-enumeration, network quota and real provider are
 * mandatory before this can be exposed publicly.
 */
export async function issueAccountOtpChallenge(
  db:Pick<PoolClient,'query'>,
  input:{channel:AccountOtpChannel;purpose:AccountOtpPurpose;contact:unknown},
  secrets:{otpPepper:Buffer;contactPepper:Buffer;contactKey:Buffer},
):Promise<PrivateAccountOtpDispatch>{
  if(!['EMAIL','SMS'].includes(input.channel)||
     !['SIGN_IN','SIGN_UP'].includes(input.purpose))
    throw new AccountOtpIssuanceUnavailable();
  const {otpPepper,contactPepper,contactKey}=secrets;
  if(![otpPepper,contactPepper,contactKey].every(x=>Buffer.isBuffer(x)&&x.length===32)||
     timingSafeEqual(otpPepper,contactPepper)||
     timingSafeEqual(otpPepper,contactKey)||
     timingSafeEqual(contactPepper,contactKey))
    throw new AccountOtpIssuanceUnavailable();
  let destination:string;
  try{destination=normalizeGuestContact(input.channel==='EMAIL'?'email':'sms',input.contact);}
  catch{throw new AccountOtpIssuanceUnavailable();}
  const digest=createHmac('sha256',contactPepper)
    .update('services-account-contact:v1\0').update(input.channel)
    .update('\0').update(destination).digest('hex');
  // Global -> contact lock order prevents cross-process race and deadlock.
  // Denied issuance throws: no budget is recorded and no challenge inserted.
  const global=await checkAccountOtpGlobalBudget(db);
  if(!global.allowed)throw new AccountOtpIssuanceUnavailable();
  // Lock contact-specific issuance on a transaction connection so concurrent
  // callers cannot bypass cooldown. Do not use this as a replacement for
  // public IP/device/global quotas.
  await db.query('SELECT pg_advisory_xact_lock(hashtext($1::text),hashtext($2::text))',
    ['account-otp-issuance:v1',digest]);
  const quota=await db.query<{recent:string;latest:Date|null}>(`
    SELECT count(*) FILTER
      (WHERE created_at>now()-interval '10 minutes')::text AS recent,
      max(created_at) AS latest
    FROM account_auth_challenges
    WHERE contact_digest=$1
      AND created_at>now()-interval '10 minutes'
  `,[digest]);
  const info=quota.rows[0];
  if(!info||Number(info.recent)>=3||
     (info.latest instanceof Date&&info.latest.getTime()>Date.now()-60_000))
    throw new AccountOtpIssuanceUnavailable();

  const challengeId=randomUUID();
  const {code,codeHash}=generateAccountOtp(challengeId,input.purpose,otpPepper);
  const iv=randomBytes(12);
  const cipher=createCipheriv('aes-256-gcm',contactKey,iv);
  cipher.setAAD(Buffer.from('services-account-contact:v1'));
  const encrypted=Buffer.concat([cipher.update(destination,'utf8'),cipher.final()]);
  const contactCipher=['v1',iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),encrypted.toString('base64url')].join('.');
  await db.query(`
    INSERT INTO account_auth_challenges
      (id,channel,purpose,contact_digest,contact_cipher,code_hash,expires_at)
    VALUES($1,$2::"AuthChannel",$3::"AccountAuthPurpose",$4,$5,$6,
      now()+($7::integer*interval '1 second'))
  `,[challengeId,input.channel,input.purpose,digest,contactCipher,codeHash,
    ACCOUNT_OTP_TTL_SECONDS]);
  // PRIVATE return value: must never be serialized in an API or logged.
  return {challengeId,channel:input.channel,purpose:input.purpose,
    destination,code,expiresInSeconds:ACCOUNT_OTP_TTL_SECONDS};
}

/** Fail closed when deployment secrets are absent or accidentally reused. */
export function loadAccountOtpIssuanceSecrets(){
  const otpPepper=requireSecret(process.env.ACCOUNT_OTP_HMAC_KEY);
  const contactPepper=requireSecret(process.env.ACCOUNT_CONTACT_HMAC_KEY);
  const contactKey=requireSecret(process.env.ACCOUNT_CONTACT_ENCRYPTION_KEY);
  return {otpPepper,contactPepper,contactKey};
}
