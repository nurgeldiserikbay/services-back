import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomBytes,randomUUID} from 'node:crypto';
import {UnauthorizedException} from '@nestjs/common';
import {issueAdminSessionToken} from '../src/modules/admin/admin-session-token.js';
import {hashAppealBffSessionToken} from '../src/modules/admin/admin-professional-appeal-bff-session-issuance.js';
import {
 createAppealBffPerAppealSessionResolver,
 issueAppealBffScopedCsrfFromRawCookie,
 executeAppealBffScopedMutationFromRawCookie,
} from '../src/modules/admin/admin-professional-appeal-bff-scoped-flow.js';

test('scoped BFF request chain derives scope from appeal, then validates cookie and CSRF',async()=>{
 const origin='https://admin.example.kz',now=Date.UTC(2026,10,19,12);
 const pepper=randomBytes(32),csrfKey=randomBytes(32);
 const cookie=randomBytes(32).toString('base64url'),hash=hashAppealBffSessionToken(cookie,pepper);
 const bearer=issueAdminSessionToken(randomBytes(32)).token;
 const appealId=randomUUID(),otherAppeal=randomUUID(),sessionId=randomUUID();
 const scope='professional:'+randomUUID();
 const rawCookieHeader='theme=light; __Host-services-appeal-session='+cookie;
 let grant=true,active=true,scopeCalls=0,lookupCalls=0,bearerCalls=0,claims=0,executes=0;
 const resolve=createAppealBffPerAppealSessionResolver({
  resolveAppealScope:async(id,action)=>{
   scopeCalls++;
   return id===appealId&&(action==='decision'||action==='assignment')?scope:
    id===otherAppeal?'professional:'+randomUUID():null;
  },
  lookupScopedSession:async(tokenHash,checkedScope)=>{
   lookupCalls++;
   assert.equal(tokenHash,hash);
   return checkedScope===scope&&grant&&active?
    {sessionId,expiresAt:now+600_000,revokedAt:null}:null;
  },
  resolvePrivilegedBearer:async(id)=>{
   bearerCalls++;assert.equal(id,sessionId);return bearer;
  },
 },pepper,()=>now);
 const request={rawCookieHeader,appealId,action:'assignment' as const,
  method:'POST',requestOrigin:origin,fetchSite:'same-origin',
  expectedOrigin:origin,csrfKey,now};
 const deps={
  resolveSessionForAppeal:resolve,
  claimCsrfProof:async()=>{claims++;return true;},
  execute:async(_action:string,_bearer:string,_id:string,_body:unknown)=>{
   executes++;return {ok:true};
  },
 };
 const token=(await issueAppealBffScopedCsrfFromRawCookie(request,deps)).token;
 assert.deepEqual(await executeAppealBffScopedMutationFromRawCookie({
  ...request,body:{outcome:'valid'},csrfToken:token,contentType:'application/json',
 },deps),{ok:true});
 assert.equal(executes,1);assert.equal(claims,1);
 const before=lookupCalls;
 await assert.rejects(issueAppealBffScopedCsrfFromRawCookie({
  ...request,rawCookieHeader:'__Host-services-appeal-session=bad',
 },deps),UnauthorizedException);
 assert.equal(lookupCalls,before,'malformed raw cookie cannot reach resolver');
 await assert.rejects(issueAppealBffScopedCsrfFromRawCookie({
  ...request,appealId:otherAppeal,
 },deps),UnauthorizedException,'different appeal cannot inherit previous scope');
 grant=false;
 await assert.rejects(executeAppealBffScopedMutationFromRawCookie({
  ...request,body:{},csrfToken:token,contentType:'application/json',
 },deps),UnauthorizedException,'revoked scope cannot forward despite signed CSRF');
 active=false;
 await assert.rejects(issueAppealBffScopedCsrfFromRawCookie(request,deps),UnauthorizedException);
 assert.equal(claims,1);assert.equal(executes,1);
 assert.ok(scopeCalls>=4&&lookupCalls>=4&&bearerCalls>=2);
});

test('scoped BFF requests reject unsafe origin before querying appeal authority',async()=>{
 const cookie=randomBytes(32).toString('base64url'),origin='https://admin.example.kz';
 const appealId=randomUUID(),csrfKey=randomBytes(32);
 let scopeCalls=0,lookupCalls=0,claims=0;
 const pepper=randomBytes(32);
 const resolver=createAppealBffPerAppealSessionResolver({
  resolveAppealScope:async()=>{scopeCalls++;return 'professional:'+randomUUID();},
  lookupScopedSession:async()=>{lookupCalls++;return null;},
  resolvePrivilegedBearer:async()=>null,
 },pepper);
 const request={rawCookieHeader:'__Host-services-appeal-session='+cookie,
  appealId,action:'decision' as const,csrfKey,
  method:'POST',requestOrigin:undefined,expectedOrigin:undefined,
  fetchSite:'same-origin'};
 await assert.rejects(issueAppealBffScopedCsrfFromRawCookie(request as never,{
  resolveSessionForAppeal:resolver,
 }),UnauthorizedException);
 await assert.rejects(executeAppealBffScopedMutationFromRawCookie({
  ...request,body:{},contentType:'application/json',csrfToken:'bad',
 } as never,{
  resolveSessionForAppeal:resolver,
  claimCsrfProof:async()=>{claims++;return true;},
  execute:async()=>({ok:true}),
 }),UnauthorizedException);
 assert.equal(scopeCalls,0);assert.equal(lookupCalls,0);assert.equal(claims,0);
});

test('invalid DB-derived resource scope and appeal IDs fail before session lookup',async()=>{
 let lookups=0;
 const resolver=createAppealBffPerAppealSessionResolver({
  resolveAppealScope:async()=>null,
  lookupScopedSession:async()=>{lookups++;return null;},
  resolvePrivilegedBearer:async()=>null,
 },randomBytes(32));
 const cookie=randomBytes(32).toString('base64url');
 assert.equal(await resolver(cookie,'invalid','decision'),null);
 assert.equal(await resolver(cookie,randomUUID(),'unknown'),null);
 assert.equal(await resolver(cookie,randomUUID(),'decision'),null);
 assert.equal(lookups,0);
});
