import {UnauthorizedException} from '@nestjs/common';

/** Server-only, unregistered browser cookie boundary for future appeal BFF.
 * Require exactly one opaque __Host- cookie; never choose first/last duplicate.
 * Route adapter must pass raw Cookie header values (not a parsed cookie map).
 */
export function extractAppealBffSessionCookie(
 rawCookieHeader:unknown,
 cookieName='__Host-services-appeal-session',
):string{
 const deny=():never=>{throw new UnauthorizedException('Authentication required');};
 if(typeof rawCookieHeader!=='string'||rawCookieHeader.length>4096||
  rawCookieHeader.length===0||/[\x00-\x1f\x7f]/.test(rawCookieHeader)||cookieName!=='__Host-services-appeal-session')
  return deny();
 const parts=rawCookieHeader.split(';');
 if(parts.length>32)return deny();
 let found:string|null=null;
 const names=new Set<string>();
 for(const part of parts){
  const trimmed=part.trim();
  const equal=trimmed.indexOf('=');
  if(equal<=0)return deny();
  const name=trimmed.slice(0,equal);
  const value=trimmed.slice(equal+1);
  // RFC cookie-octet subset: deny quotes, control characters, Unicode,
  // duplicate cookie names, percent-decoding and delimiter confusion.
  if(!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name)||
   !/^[\x21\x23-\x2B\x2D-\x3A\x3C-\x5B\x5D-\x7E]*$/.test(value)||
   names.has(name.toLowerCase()))return deny();
  names.add(name.toLowerCase());
  if(name===cookieName){
   if(!/^[A-Za-z0-9_-]{16,512}$/.test(value))return deny();
   found=value;
  }
 }
 if(found===null)return deny();
 return found;
}
