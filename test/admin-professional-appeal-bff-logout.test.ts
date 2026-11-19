import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomBytes,randomUUID} from 'node:crypto';
import {UnauthorizedException} from '@nestjs/common';
import {logoutAppealBffSession} from '../src/modules/admin/admin-professional-appeal-bff-logout.js';
import {issueAppealBffCsrfFromRawCookie} from '../src/modules/admin/admin-professional-appeal-bff-raw-cookie.js';
import {executeAppealBffMutationFromRawCookie} from '../src/modules/admin/admin-professional-appeal-bff-raw-cookie.js';
import {issueAdminSessionToken} from '../src/modules/admin/admin-session-token.js';

test('logout commits server session revocation before returning clear-cookie header',async()=>{
 const cookie=randomBytes(32).toString('base64url');
 const origin='https://admin.example.kz';
 const request={rawCookieHeader:'theme=light; __Host-services-appeal-session='+cookie,
  method:'POST',requestOrigin:origin,fetchSite:'same-origin',expectedOrigin:origin};
 let count=0,committed=false;
 const result=await logoutAppealBffSession(request,{
  revokeSession:async(value)=>{
   count++;assert.equal(value,cookie);
   await Promise.resolve();committed=true;return true;
  },
 });
 assert.equal(count,1);assert.equal(committed,true);
 assert.equal(result.headers['Cache-Control'],'no-store');
 assert.equal(result.headers['Pragma'],'no-cache');
 assert.equal(result.headers['Set-Cookie'],
  '__Host-services-appeal-session=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0');
 assert.ok(!JSON.stringify(result).includes(cookie));
});

test('logout denies unsafe requests before invoking revocation',async()=>{
 const cookie=randomBytes(32).toString('base64url'),origin='https://admin.example.kz';
 const name='__Host-services-appeal-session';
 const base={rawCookieHeader:name+'='+cookie,method:'POST',
  requestOrigin:origin,expectedOrigin:origin,fetchSite:'same-origin'};
 let count=0;
 const deps={revokeSession:async()=>{count++;return true;}};
 for(const patch of [
  {method:'GET'},{method:'DELETE'},{fetchSite:'cross-site'},{fetchSite:'same-site'},
  {requestOrigin:'https://evil.example.kz'},{requestOrigin:undefined},
  {expectedOrigin:undefined,requestOrigin:undefined},
  {expectedOrigin:'http://admin.example.kz',requestOrigin:'http://admin.example.kz'},
  {expectedOrigin:'https://admin.example.kz/path',requestOrigin:'https://admin.example.kz/path'},
  {expectedOrigin:'https://admin..example.kz',requestOrigin:'https://admin..example.kz'},
  {expectedOrigin:'https://user@admin.example.kz',requestOrigin:'https://user@admin.example.kz'},
  {rawCookieHeader:name+'='+cookie+'; '+name+'='+cookie},
  {rawCookieHeader:name+'='+cookie+'; extra="quoted"'},
  {rawCookieHeader:name+'=bad'},{rawCookieHeader:undefined},
 ]){
  await assert.rejects(logoutAppealBffSession({...base,...patch} as typeof base,deps),UnauthorizedException);
 }
 assert.equal(count,0);
});

test('logout never clears cookie on unavailable, uncertain or failed revocation',async()=>{
 const opaque=randomBytes(32).toString('base64url'),origin='https://admin.example.kz';
 const request={rawCookieHeader:'__Host-services-appeal-session='+opaque,
  method:'POST',requestOrigin:origin,expectedOrigin:origin,fetchSite:'same-origin'};
 for(const revokeSession of [
  async()=>false,async()=>{throw new Error('storage unavailable');},
  async()=>{throw new Error('commit not confirmed');},
 ]){
  await assert.rejects(logoutAppealBffSession(request,{revokeSession}));
 }
 await assert.rejects(logoutAppealBffSession(request,{revokeSession:async()=>false}),
  UnauthorizedException);
});

test('revoked opaque session is not accepted for CSRF issuance or mutation',async()=>{
 const opaque=randomBytes(32).toString('base64url'),origin='https://admin.example.kz';
 const sessionId=randomUUID(),appealId=randomUUID(),csrfKey=randomBytes(32);
 const adminBearer=issueAdminSessionToken(randomBytes(32)).token;
 const rawCookieHeader='__Host-services-appeal-session='+opaque;
 let active=true,executions=0,claims=0;
 const resolveSession=async(cookie:string)=>cookie===opaque&&active?
  {sessionId,adminBearer}:null;
 const issueReq={rawCookieHeader,method:'POST',requestOrigin:origin,
  fetchSite:'same-origin',expectedOrigin:origin,appealId,
  action:'assignment' as const,csrfKey};
 const token=(await issueAppealBffCsrfFromRawCookie(issueReq,{resolveSession})).token;
 const logout=await logoutAppealBffSession({
  rawCookieHeader,method:'POST',requestOrigin:origin,
  fetchSite:'same-origin',expectedOrigin:origin,
 },{revokeSession:async(cookie)=>{assert.equal(cookie,opaque);active=false;return true;}});
 assert.match(logout.headers['Set-Cookie'],/Max-Age=0$/);
 await assert.rejects(issueAppealBffCsrfFromRawCookie(issueReq,{resolveSession}),
  UnauthorizedException);
 await assert.rejects(executeAppealBffMutationFromRawCookie({
  ...issueReq,body:{},csrfToken:token,contentType:'application/json',
 },{resolveSession,claimCsrfProof:async()=>{claims++;return true;},
  execute:async()=>{executions++;return {ok:true};}}),UnauthorizedException);
 assert.equal(claims,0);assert.equal(executions,0);
});
