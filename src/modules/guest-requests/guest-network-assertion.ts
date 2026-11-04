import {createHmac,timingSafeEqual} from 'node:crypto';
import {requireSecret} from './guest-request.security.js';

/**
 * Only a trusted edge may create this assertion after replacing all
 * untrusted forwarding headers. The digest identifies a network bucket,
 * not a raw IP, and is never returned/logged. The signature prevents
 * forged or arbitrarily rotated client-supplied network buckets.
 */
export function verifyTrustedNetworkAssertion(
  value:unknown,secretEncoded:string|undefined,now=Date.now(),
):string|null{
  if(typeof value!=='string'||value.length>200||
    !Number.isSafeInteger(now))return null;
  const match=/^v1\.([0-9]{10,13})\.([a-f0-9]{64})\.([a-f0-9]{64})$/.exec(value);
  if(!match)return null;
  const timestamp=Number(match[1]);
  if(!Number.isSafeInteger(timestamp)||Math.abs(now-timestamp)>30000)return null;
  let key:Buffer;
  try{key=requireSecret(secretEncoded);}catch{return null;}
  const digest=match[2];
  const mac=createHmac('sha256',key)
    .update('guest-network-assertion:v1\0')
    .update(String(timestamp)).update('\0').update(digest)
    .digest();
  return timingSafeEqual(mac,Buffer.from(match[3],'hex'))?digest:null;
}
