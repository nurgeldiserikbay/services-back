import {
 Controller,Header,Headers,HttpCode,Inject,Param,Post,Req,Body,UnauthorizedException,
} from '@nestjs/common';
import type {AppealBffMutation} from './admin-professional-appeal-bff-csrf.js';
import {isTrustedAppealBffOrigin} from './admin-professional-appeal-bff-origin.js';
import {extractAppealBffSessionCookie} from './admin-professional-appeal-bff-cookie.js';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const JSON_TYPE=/^application\/json(?:;\s*charset=utf-8)?$/i;
const CSRF=/^v1\.[0-9]{13}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}$/;
export const APPEAL_BFF_HTTP_BOUNDARY=Symbol('APPEAL_BFF_HTTP_BOUNDARY');

type SafeRequest=Readonly<{
 rawHeaders?:readonly string[];
 method?:unknown;
}>;
export type BffHttpContext=Readonly<{
 rawCookieHeader:string;appealId:string;action:AppealBffMutation;
 method:'POST';requestOrigin:string;fetchSite:'same-origin';
 expectedOrigin:string;
}>;
export type BffHttpMutationContext=BffHttpContext&Readonly<{
 contentType:string;csrfToken:string;body:unknown;
}>;
export type AppealBffHttpBoundary=Readonly<{
 /** MUST be trusted deployment configuration, never derived from HTTP headers. */
 expectedOrigin:string;
 /** Implement with server-only HMAC key, scoped PG session and CSRF issuer. */
 issueCsrf:(request:BffHttpContext)=>Promise<{token:string}>;
 /** Implement with Redis one-use claim and transaction-locked privileged executor. */
 mutate:(request:BffHttpMutationContext)=>Promise<unknown>;
}>;

function deny():never{throw new UnauthorizedException('Authentication required');}
function exactlyOne(req:SafeRequest,name:string):string|null{
 const raw=req.rawHeaders;
 if(!Array.isArray(raw)||raw.length%2!==0||raw.length>200)return null;
 const matches:string[]=[];
 for(let i=0;i<raw.length;i+=2){
  if(typeof raw[i]!=='string'||typeof raw[i+1]!=='string')return null;
  if(raw[i].toLowerCase()===name)matches.push(raw[i+1]);
 }
 return matches.length===1?matches[0]:null;
}
/**
 * Prepared, UNREGISTERED NestJS appeal BFF browser transport.
 * No production module imports this controller. A future module needs an
 * explicitly audited provider and security sign-off before activation.
 */
@Controller('admin/bff/moderation/appeals')
export class PlatformProfessionalAppealBffController{
 constructor(@Inject(APPEAL_BFF_HTTP_BOUNDARY)
  private readonly boundary:AppealBffHttpBoundary){}

 private preflight(
  request:SafeRequest,appealId:unknown,action:unknown,
 ):BffHttpContext{
  if(process.env.SERVICES_ENABLE_PLATFORM_APPEAL_BFF_HTTP!=='enabled'||
   !this.boundary||!isTrustedAppealBffOrigin(this.boundary.expectedOrigin)||
   request?.method!=='POST'||
   typeof appealId!=='string'||!UUID.test(appealId)||
   (action!=='assignment'&&action!=='decision'))return deny();
  const origin=exactlyOne(request,'origin');
  const fetchSite=exactlyOne(request,'sec-fetch-site');
  const rawCookieHeader=exactlyOne(request,'cookie');
  // Browser-only route: privileged Authorization bearer is NEVER accepted.
  if(origin!==this.boundary.expectedOrigin||fetchSite!=='same-origin'||
   rawCookieHeader===null||
   (Array.isArray(request.rawHeaders)&&request.rawHeaders.some((h,i)=>
    i%2===0&&typeof h==='string'&&h.toLowerCase()==='authorization')))
   return deny();
  extractAppealBffSessionCookie(rawCookieHeader);
  return {rawCookieHeader,appealId,action:action as AppealBffMutation,
   method:'POST',requestOrigin:origin,fetchSite:'same-origin',
   expectedOrigin:this.boundary.expectedOrigin};
 }

 @Post(':id/:action/csrf')
 @HttpCode(200)
 @Header('Cache-Control','private, no-store, max-age=0')
 @Header('Pragma','no-cache')
 @Header('Referrer-Policy','no-referrer')
 @Header('X-Content-Type-Options','nosniff')
 @Header('X-Robots-Tag','noindex, nofollow')
 @Header('Vary','Origin, Cookie')
 issue(@Req() request:SafeRequest,@Param('id') id:unknown,
  @Param('action') action:unknown,@Body() body:unknown){
  const context=this.preflight(request,id,action);
  if(exactlyOne(request,'content-type')!=='application/json'||
   !body||typeof body!=='object'||Array.isArray(body)||
   Object.getPrototypeOf(body)!==Object.prototype||
   Object.keys(body).length!==0)return deny();
  if(typeof this.boundary.issueCsrf!=='function')return deny();
  return this.boundary.issueCsrf(context);
 }

 @Post(':id/:action')
 @HttpCode(200)
 @Header('Cache-Control','private, no-store, max-age=0')
 @Header('Pragma','no-cache')
 @Header('Referrer-Policy','no-referrer')
 @Header('X-Content-Type-Options','nosniff')
 @Header('X-Robots-Tag','noindex, nofollow')
 @Header('Vary','Origin, Cookie')
 mutate(@Req() request:SafeRequest,@Param('id') id:unknown,
  @Param('action') action:unknown,@Body() body:unknown){
  const context=this.preflight(request,id,action);
  const contentType=exactlyOne(request,'content-type');
  const csrfToken=exactlyOne(request,'x-appeal-csrf');
  if(typeof contentType!=='string'||!JSON_TYPE.test(contentType)||
   typeof csrfToken!=='string'||!CSRF.test(csrfToken)||
   !body||typeof body!=='object'||Array.isArray(body)||
   Object.getPrototypeOf(body)!==Object.prototype||
   typeof this.boundary.mutate!=='function')return deny();
  return this.boundary.mutate({...context,contentType,csrfToken,body});
 }
}
