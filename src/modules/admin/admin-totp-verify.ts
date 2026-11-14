import {createHmac,timingSafeEqual} from 'node:crypto';

const STEP_MS=30_000;
const MAX_DATE_MS=8_640_000_000_000_000;

/**
 * Verify a provisioned RFC 6238 SHA-1 six-digit TOTP in server memory.
 * The secret must come from authenticated, decrypted server-side storage.
 * Return the matched counter for atomic replay consumption, not a login grant.
 * Do not log the secret, code or counter.
 */
export function verifyAdminTotp(
 secret:Buffer,
 code:unknown,
 now=Date.now(),
):number|null{
 if(!Buffer.isBuffer(secret)||secret.length<20||secret.length>128||
    typeof code!=='string'||!/^[0-9]{6}$/.test(code)||
    !Number.isSafeInteger(now)||now<0||now>MAX_DATE_MS)
  return null;
 const current=Math.floor(now/STEP_MS);
 for(const drift of [-1,0,1]){
  const counter=current+drift;
  if(counter<0||!Number.isSafeInteger(counter))continue;
  const message=Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest=createHmac('sha1',secret).update(message).digest();
  const offset=digest[digest.length-1]&15;
  const value=(digest.readUInt32BE(offset)&0x7fffffff)%1_000_000;
  const expected=Buffer.from(String(value).padStart(6,'0'),'ascii');
  if(timingSafeEqual(expected,Buffer.from(code,'ascii')))
   return counter;
 }
 return null;
}
