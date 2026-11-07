import {timingSafeEqual} from 'node:crypto';
import {NotFoundException} from '@nestjs/common';
import {requireSecret} from '../guest-requests/guest-request.security.js';

/**
 * Private BFF authentication, independent of web-cookie encryption and OTP keys.
 * No caller-supplied account ID, network IP, or untrusted forwarded header.
 * The ingress must ALSO restrict transport to the trusted web BFF over TLS.
 */
export function requirePrivateAccountLoginAccess(value:unknown):void{
 if(process.env.SERVICES_ENABLE_ACCOUNT_LOGIN_HTTP!=='enabled')
  throw new NotFoundException();
 try{
  const secret=requireSecret(process.env.ACCOUNT_LOGIN_BFF_KEY);
  if(typeof value!=='string'||!/^[A-Za-z0-9+/]{43}=$/.test(value))
   throw new Error('invalid');
  const incoming=requireSecret(value);
  if(!timingSafeEqual(secret,incoming))throw new Error('unauthorized');
 }catch{throw new NotFoundException();}
}
