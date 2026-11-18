import {UnauthorizedException} from '@nestjs/common';

const JSON_TYPE=/^application\/json(?:;\s*charset=utf-8)?$/i;
const browserProvenance=[
 'origin','referer','cookie','sec-fetch-site','sec-fetch-mode',
 'sec-fetch-dest','sec-fetch-user',
] as const;

/** Prepared internal server-to-server appeal transport. Browser callers must
 * use a separately approved BFF/CSRF workflow, never these private handlers.
 * Absence of browser metadata is only a transport precondition, NOT identity
 * proof: session, role, MFA and scope must still be verified by the service.
 */
export function assertPrivateAppealTransport(headers:unknown):void{
 if(!headers||typeof headers!=='object'||Array.isArray(headers))
  throw new UnauthorizedException('Authentication required');
 const values=headers as Record<string,unknown>;
 const type=values['content-type'];
 if(typeof type!=='string'||!JSON_TYPE.test(type))
  throw new UnauthorizedException('Authentication required');
 for(const name of browserProvenance){
  // Reject even empty or "null" values: all indicate client/browser context.
  if(values[name]!==undefined)
   throw new UnauthorizedException('Authentication required');
 }
}
