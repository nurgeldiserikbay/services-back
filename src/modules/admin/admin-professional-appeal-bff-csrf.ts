import {createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
import {UnauthorizedException} from '@nestjs/common';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NONCE=/^[A-Za-z0-9_-]{22}$/;
const TOKEN=/^v1\.([0-9]{13})\.([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{43})$/;
const TTL_MS=10*60*1000;
export type AppealBffMutation='assignment'|'decision';

type Context={
 sessionId:string;appealId:string;action:AppealBffMutation;
 origin:string;csrfKey:Buffer;
};
type BrowserMutation=Context&{
 method:unknown;requestOrigin:unknown;fetchSite:unknown;
 contentType:unknown;csrfToken:unknown;cookieAuthenticated:boolean;
 now?:number;
};
function canonical(input:Context):boolean{
 return typeof input.sessionId==='string'&&UUID.test(input.sessionId)&&
  typeof input.appealId==='string'&&UUID.test(input.appealId)&&
  (input.action==='assignment'||input.action==='decision')&&
  typeof input.origin==='string'&&
  /^https:\/\/[a-z0-9.-]+(?::[0-9]{2,5})?$/i.test(input.origin)&&
  !input.origin.includes('..')&&
  Buffer.isBuffer(input.csrfKey)&&input.csrfKey.length===32;
}
function proof(input:Context,issuedAt:number,nonce:string):Buffer{
 const data=['appeal-bff-csrf-v1',input.sessionId.toLowerCase(),
  input.appealId.toLowerCase(),input.action,input.origin,issuedAt,nonce].join('\n');
 return createHmac('sha256',input.csrfKey).update(data).digest();
}
/** Prepared BFF helper only. Call after validating an authenticated browser
 * session and origin policy. Never expose csrfKey or a platform admin bearer.
 * Token is bound to server-side session, operation, appeal ID and origin.
 */
export function issueAppealBffCsrf(input:Context,now=Date.now()):string{
 if(!canonical(input)||!Number.isSafeInteger(now)||now<0||
  now>8_640_000_000_000_000)
  throw new UnauthorizedException('Authentication required');
 const nonce=randomBytes(16).toString('base64url');
 const mac=proof(input,now,nonce).toString('base64url');
 return 'v1.'+now+'.'+nonce+'.'+mac;
}
/** Validate a same-origin browser mutation; this is NOT an auth or grant check.
 * Session lookup, MFA, live grants, and server-side forwarding are separate.
 * Allow no CORS, no Referer-only fallback, and no cookie-only auth.
 */
export function assertAppealBffCsrf(input:BrowserMutation):void{
 const deny=()=>{throw new UnauthorizedException('Authentication required');};
 if(!canonical(input)||input.cookieAuthenticated!==true||
  input.method!=='POST'||input.requestOrigin!==input.origin||
  input.fetchSite!=='same-origin'||
  typeof input.contentType!=='string'||
  !/^application\/json(?:;\s*charset=utf-8)?$/i.test(input.contentType)||
  typeof input.csrfToken!=='string'||input.csrfToken.length>110)
  return deny();
 const match=TOKEN.exec(input.csrfToken);
 if(!match)return deny();
 const issuedAt=Number(match[1]),now=input.now??Date.now();
 if(!Number.isSafeInteger(issuedAt)||!Number.isSafeInteger(now)||
  now<issuedAt||now-issuedAt>TTL_MS||
  !NONCE.test(match[2]))return deny();
 const expected=proof(input,issuedAt,match[2]);
 const provided=Buffer.from(match[3],'base64url');
 if(provided.length!==expected.length||!timingSafeEqual(provided,expected))
  return deny();
}
