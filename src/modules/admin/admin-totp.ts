import {createHmac,timingSafeEqual} from 'node:crypto';

/**
 * A pure verifier for a provisioned admin TOTP factor (RFC 6238).
 * The secret must come from protected server-side storage, never the browser.
 * The returned counter MUST be consumed atomically in persistent storage
 * before any privileged session is issued; this helper alone does not
 * prevent replay or authenticate the primary factor.
 */
export function verifyAdminTotp(
 secret:Buffer,
 code:unknown,
 now:number,
 lastConsumedCounter:number,
):number|null{
 if(!Buffer.isBuffer(secret)||secret.length<20||secret.length>128||
    typeof code!=='string'||!/^[0-9]{6}$/.test(code)||
    !Number.isSafeInteger(now)||now<0||now>8_640_000_000_000_000||
    !Number.isSafeInteger(lastConsumedCounter)||lastConsumedCounter< -1)
  return null;
 const current=Math.floor(now/30_000);
 let matched:number|null=null;
 if(!Number.isSafeInteger(current)||current>Number.MAX_SAFE_INTEGER-1)return null;
 // One adjacent step tolerates modest clock skew, but never accepts replay.
 for(const counter of [current-1,current,current+1]){
  if(counter<0||counter<=lastConsumedCounter)continue;
  const input=Buffer.alloc(8);
  input.writeBigUInt64BE(BigInt(counter));
  const digest=createHmac('sha1',secret).update(input).digest();
  const offset=digest[digest.length-1]!&0x0f;
  const binary=(digest.readUInt32BE(offset)&0x7fffffff)%1_000_000;
  const expected=Buffer.from(String(binary).padStart(6,'0'),'ascii');
  // Compare every eligible step to avoid leaking the matching time offset.
  // Prefer the latest eligible counter if adjacent steps share a code.
  if(timingSafeEqual(expected,Buffer.from(code,'ascii')))matched=counter;
 }
 return matched;
}
