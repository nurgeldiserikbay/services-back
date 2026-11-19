import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomBytes,randomUUID} from 'node:crypto';
import {UnauthorizedException} from '@nestjs/common';
import {issueAppealBffCsrfForSession} from '../src/modules/admin/admin-professional-appeal-bff-csrf-issuer.js';
import {assertAppealBffCsrf} from '../src/modules/admin/admin-professional-appeal-bff-csrf.js';

test('prepared issuer uses only live resolver identity, produces session-scoped proof and no-store response',async()=>{
 const cookie=randomBytes(32).toString('base64url');
 const sessionId=randomUUID(),appealId=randomUUID(),csrfKey=randomBytes(32);
 const origin='https://admin.example.kz',now=Date.UTC(2026,10,19,6,0);
 const base={sessionCookie:cookie,appealId,action:'assignment',method:'POST',
  requestOrigin:origin,fetchSite:'same-origin',expectedOrigin:origin,csrfKey,now};
 let resolved=0;let active=true;
 const deps={resolveSession:async(key:string)=>{
  resolved++;return active&&key===cookie?{sessionId}:null;
 }};
 const response=await issueAppealBffCsrfForSession(base,deps);
 assert.deepEqual(Object.keys(response).sort(),['headers','token']);
 assert.equal(response.headers['Cache-Control'],'no-store');
 assert.equal(response.headers['Referrer-Policy'],'no-referrer');
 assert.equal(response.headers['X-Content-Type-Options'],'nosniff');
 assert.doesNotThrow(()=>assertAppealBffCsrf({
  sessionId,appealId,action:'assignment',origin,csrfKey,
  method:'POST',requestOrigin:origin,fetchSite:'same-origin',
  contentType:'application/json',csrfToken:response.token,
  cookieAuthenticated:true,now,
 }));
 assert.throws(()=>assertAppealBffCsrf({
  sessionId:randomUUID(),appealId,action:'assignment',origin,csrfKey,
  method:'POST',requestOrigin:origin,fetchSite:'same-origin',
  contentType:'application/json',csrfToken:response.token,
  cookieAuthenticated:true,now,
 }),UnauthorizedException);
 active=false;
 await assert.rejects(issueAppealBffCsrfForSession(base,deps),UnauthorizedException);
 assert.equal(resolved,2);
});

test('prepared issuer rejects browser-origin and untrusted identities before resolving',async()=>{
 const cookie=randomBytes(32).toString('base64url'),origin='https://admin.example.kz';
 const base={sessionCookie:cookie,appealId:randomUUID(),action:'decision',
  method:'POST',requestOrigin:origin,fetchSite:'same-origin',expectedOrigin:origin,
  csrfKey:randomBytes(32)};
 let calls=0;
 const deps={resolveSession:async()=>{
  calls++;return {sessionId:randomUUID()};
 }};
 for(const patch of [
  {method:'GET'},{method:'OPTIONS'},{requestOrigin:undefined},
  {requestOrigin:'https://evil.example.kz'},
  {requestOrigin:'null'},{fetchSite:'cross-site'},{fetchSite:'same-site'},
  {fetchSite:undefined},{sessionCookie:undefined},{sessionCookie:'bad'},
  {sessionCookie:'a'.repeat(513)},{sessionCookie:'x=y'},
  {appealId:'bad'},{action:'export'},
 ]){
  await assert.rejects(issueAppealBffCsrfForSession({...base,...patch},deps),UnauthorizedException);
 }
 assert.equal(calls,0);
 await assert.rejects(issueAppealBffCsrfForSession(base,{
  resolveSession:async()=>({sessionId:'browser-forged'}),
 }),UnauthorizedException);
 await assert.rejects(issueAppealBffCsrfForSession({...base,csrfKey:Buffer.alloc(0)},deps),UnauthorizedException);
});
