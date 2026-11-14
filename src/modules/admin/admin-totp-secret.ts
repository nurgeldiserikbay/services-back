import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';

const VERSION='v1';
const IV_BYTES=12;
const TAG_BYTES=16;
const KEY_BYTES=32;
const SECRET_MIN=20;
const SECRET_MAX=128;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Envelope for server-side TOTP secret storage.
 * Encryption keys must be provided by an external secret manager, rotated
 * separately, and never persisted alongside the encrypted factor.
 * Staff UUID is authenticated as AAD to prevent ciphertext swapping.
 */
export function sealAdminTotpSecret(
 secret:Buffer,
 staffId:string,
 key:Buffer,
):string{
 if(!Buffer.isBuffer(secret)||secret.length<SECRET_MIN||
    secret.length>SECRET_MAX||(typeof staffId!=='string'||!UUID.test(staffId))||
    !Buffer.isBuffer(key)||key.length!==KEY_BYTES)
  throw new Error('invalid_admin_totp_secret_envelope');
 const iv=randomBytes(IV_BYTES);
 const cipher=createCipheriv('aes-256-gcm',key,iv);
 cipher.setAAD(Buffer.from(staffId.toLowerCase(),'ascii'));
 const encrypted=Buffer.concat([cipher.update(secret),cipher.final()]);
 return [VERSION,iv.toString('base64url'),
  encrypted.toString('base64url'),
  cipher.getAuthTag().toString('base64url')].join('.');
}

export function openAdminTotpSecret(
 envelope:unknown,
 staffId:string,
 key:Buffer,
):Buffer|null{
 if(typeof envelope!=='string'||envelope.length>512||
    (typeof staffId!=='string'||!UUID.test(staffId))||!Buffer.isBuffer(key)||key.length!==KEY_BYTES)
  return null;
 const parts=envelope.split('.');
 if(parts.length!==4||parts[0]!==VERSION)return null;
 const [,ivText,cipherText,tagText]=parts;
 if(!ivText||!cipherText||!tagText||
    !/^[A-Za-z0-9_-]+$/.test(ivText)||
    !/^[A-Za-z0-9_-]+$/.test(cipherText)||
    !/^[A-Za-z0-9_-]+$/.test(tagText))return null;
 const iv=Buffer.from(ivText,'base64url');
 const encrypted=Buffer.from(cipherText,'base64url');
 const tag=Buffer.from(tagText,'base64url');
 if(iv.length!==IV_BYTES||tag.length!==TAG_BYTES||
    encrypted.length<SECRET_MIN||encrypted.length>SECRET_MAX||
    iv.toString('base64url')!==ivText||
    encrypted.toString('base64url')!==cipherText||
    tag.toString('base64url')!==tagText)return null;
 try{
  const decipher=createDecipheriv('aes-256-gcm',key,iv);
  decipher.setAAD(Buffer.from(staffId.toLowerCase(),'ascii'));
  decipher.setAuthTag(tag);
  const secret=Buffer.concat([decipher.update(encrypted),decipher.final()]);
  return secret.length>=SECRET_MIN&&secret.length<=SECRET_MAX?secret:null;
 }catch{return null;}
}
