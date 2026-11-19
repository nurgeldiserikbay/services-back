import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomBytes,randomUUID} from 'node:crypto';
import {UnauthorizedException} from '@nestjs/common';
import {issueAdminSessionToken} from '../src/modules/admin/admin-session-token.js';
import {
 issueAppealBffCsrfFromRawCookie,executeAppealBffMutationFromRawCookie,
} from '../src/modules/admin/admin-professional-appeal-bff-raw-cookie.js';

test('raw Cookie header binds issuance and one-use mutation to trusted session',async()=>{
 const cookie=randomBytes(32).toString('base64url'),sessionId=randomUUID();
 const appealId=randomUUID(),csrfKey=randomBytes(32);
 const bearer=issueAdminSessionToken(randomBytes(32)).token;
 const origin='https://admin.example.kz',now=Date.UTC(2026,10,19,7);
 const base={rawCookieHeader:'theme=light; __Host-services-appeal-session='+cookie,
  appealId,action:'assignment' as const,method:'POST',requestOrigin:origin,
  fetchSite:'same-origin',expectedOrigin:origin,csrfKey,now};
 let resolves=0,claims=0,executions=0;
 const resolveSession=async(value:string)=>{
  resolves++;assert.equal(value,cookie);return {sessionId,adminBearer:bearer};
 };
 const issued=await issueAppealBffCsrfFromRawCookie(base,{resolveSession});
 assert.equal(issued.headers['Cache-Control'],'no-store');
 const seen=new Set<string>();
 const deps={resolveSession,
  claimCsrfProof:async(_session:string,digest:string)=>{
   claims++;assert.equal(_session,sessionId);
   if(seen.has(digest))return false;seen.add(digest);return true;
  },
  execute:async(action:string,proof:string,id:string)=>{
   executions++;assert.equal(action,'assignment');assert.equal(proof,bearer);
   assert.equal(id,appealId);return {ok:true};
  },
 };
 const request={...base,body:{profile_version:1},
  contentType:'application/json',csrfToken:issued.token};
 assert.deepEqual(await executeAppealBffMutationFromRawCookie(request,deps),{ok:true});
 await assert.rejects(executeAppealBffMutationFromRawCookie(request,deps),UnauthorizedException);
 assert.equal(executions,1);assert.equal(claims,2);
 // Issuance + first mutation lookup + post-claim refresh + denied replay lookup.
 assert.equal(resolves,4);
});

test('raw Cookie ambiguity stops both flows before live session resolution',async()=>{
 const token=randomBytes(32).toString('base64url'),origin='https://admin.example.kz';
 const name='__Host-services-appeal-session';
 const base={rawCookieHeader:name+'='+token,appealId:randomUUID(),
  action:'decision' as const,method:'POST',requestOrigin:origin,
  fetchSite:'same-origin',expectedOrigin:origin,csrfKey:randomBytes(32)};
 let resolves=0,claims=0,executions=0;
 const deps={
  resolveSession:async()=>{resolves++;return {sessionId:randomUUID(),adminBearer:'invalid'};},
  claimCsrfProof:async()=>{claims++;return true;},
  execute:async()=>{executions++;return {ok:true};},
 };
 const malformed:unknown[]=[
  [name+'='+token],name+'='+token+'; '+name+'='+token,
  name+'='+token+'; '+name.toLowerCase()+'='+token,
  name+'='+token+'; extra="quoted"',name+'='+token+'; extra=bad value',
  name+'='+token+'; extra=foo\n',name+'=bad',
  name+'='+token+'; malformed',undefined,'',
 ];
 for(const rawCookieHeader of malformed){
  const req={...base,rawCookieHeader};
  await assert.rejects(issueAppealBffCsrfFromRawCookie(req,deps),UnauthorizedException);
  await assert.rejects(executeAppealBffMutationFromRawCookie({
   ...req,body:{},contentType:'application/json',csrfToken:'forged',
  },deps),UnauthorizedException);
 }
 assert.equal(resolves,0);assert.equal(claims,0);assert.equal(executions,0);
});
