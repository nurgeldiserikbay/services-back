import {timingSafeEqual} from 'node:crypto';
import {NotFoundException} from '@nestjs/common';
import {requireSecret} from '../guest-requests/guest-request.security.js';

/**
 * Dedicated private admin MFA transport credential. This is NOT a browser
 * credential and does not replace TLS ingress allowlisting or account MFA.
 * Never reuse account-login, admin-session, or TOTP encryption secrets.
 */
export function requirePrivateAdminMfaAccess(value:unknown):void{
 if(process.env.SERVICES_ENABLE_ADMIN_MFA_PRIVATE_HTTP!=='enabled')
  throw new NotFoundException();
 try{
  const expected=requireSecret(process.env.ADMIN_MFA_BFF_KEY);
  if(typeof value!=='string')throw new Error('invalid');
  const actual=requireSecret(value);
  if(!timingSafeEqual(expected,actual))throw new Error('unauthorized');
  // Disallow accidental reuse of another service credential.
  for(const other of [
   process.env.ACCOUNT_LOGIN_BFF_KEY,
   process.env.PLATFORM_ADMIN_SESSION_HMAC_KEY,
   process.env.ACCOUNT_SESSION_HMAC_KEY,
  ]){
   if(typeof other!=='string')continue;
   // Compare decoded bytes, not textual base64 spellings. Fail closed on
   // malformed configured peer secrets instead of ignoring key isolation.
   const peer=requireSecret(other);
   if(timingSafeEqual(expected,peer))throw new Error('key_reuse');
  }
 }catch{throw new NotFoundException();}
}
