import {createHmac,randomInt,timingSafeEqual} from 'node:crypto';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OTP=/^[0-9]{6}$/;
export const ACCOUNT_OTP_MAX_ATTEMPTS=5;
export const ACCOUNT_OTP_TTL_SECONDS=300;
export type AccountOtpPurpose='SIGN_IN'|'SIGN_UP';
export type AccountOtpChannel='EMAIL'|'SMS';

function validateKey(pepper:Buffer):void{
  if(!Buffer.isBuffer(pepper)||pepper.length!==32)throw new Error('account_otp_secret_unavailable');
}
/** Account code hashes cannot be used as guest OTP proofs, or vice versa. */
export function hashAccountOtp(
  challengeId:string,purpose:AccountOtpPurpose,code:string,pepper:Buffer,
):string{
  validateKey(pepper);
  if(!UUID.test(challengeId)||!['SIGN_IN','SIGN_UP'].includes(purpose)||!OTP.test(code))
    throw new Error('invalid_account_otp');
  return createHmac('sha256',pepper)
    .update('services-account-otp:v1\0')
    .update(purpose).update('\0').update(challengeId.toLowerCase())
    .update('\0').update(code).digest('hex');
}
export function generateAccountOtp(
  challengeId:string,purpose:AccountOtpPurpose,pepper:Buffer,
):{code:string;codeHash:string}{
  const code=String(randomInt(0,1_000_000)).padStart(6,'0');
  return {code,codeHash:hashAccountOtp(challengeId,purpose,code,pepper)};
}
export function verifyAccountOtp(
  challengeId:string,purpose:AccountOtpPurpose,candidate:unknown,
  storedHash:unknown,pepper:Buffer,
):boolean{
  validateKey(pepper);
  if(typeof candidate!=='string'||!OTP.test(candidate)||
     typeof storedHash!=='string'||!/^[0-9a-f]{64}$/i.test(storedHash)||
     !UUID.test(challengeId)||!['SIGN_IN','SIGN_UP'].includes(purpose))return false;
  const expected=Buffer.from(storedHash,'hex');
  const actual=Buffer.from(hashAccountOtp(challengeId,purpose,candidate,pepper),'hex');
  return timingSafeEqual(actual,expected);
}
