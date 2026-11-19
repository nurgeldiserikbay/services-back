import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomBytes} from 'node:crypto';
import {UnauthorizedException} from '@nestjs/common';
import {extractAppealBffSessionCookie} from '../src/modules/admin/admin-professional-appeal-bff-cookie.js';
import {
 hashAppealBffSessionToken,issueAppealBffBrowserSession,
} from '../src/modules/admin/admin-professional-appeal-bff-session-issuance.js';

test('prepared issuance saves only a domain-separated hash before exposing secure cookie',async()=>{
 const pepper=randomBytes(32),now=Date.UTC(2026,10,19,8);
 let savedHash='',savedUntil=0,committed=false;
 const issue=()=>issueAppealBffBrowserSession({
  persistAuthorizedSession:async(hash,expires)=>{
   assert.match(hash,/^[0-9a-f]{64}$/);
   savedHash=hash;savedUntil=expires;
   await Promise.resolve();committed=true;return true;
  },
 },pepper,900,now);
 const result=await issue();
 assert.equal(committed,true);
 assert.equal(savedUntil,now+900_000);
 const setCookie=result.headers['Set-Cookie'];
 assert.match(setCookie,/; Path=\/; Secure; HttpOnly; SameSite=Strict; Max-Age=900$/);
 const raw=extractAppealBffSessionCookie(setCookie.split(';')[0]);
 assert.equal(raw.length,43);
 assert.notEqual(raw,savedHash);
 assert.equal(hashAppealBffSessionToken(raw,pepper),savedHash);
 assert.ok(!JSON.stringify(result).includes(savedHash));
 assert.equal(result.headers['Cache-Control'],'no-store');
 assert.equal(result.headers.Pragma,'no-cache');
 const firstHash=savedHash;
 const second=await issue(),secondRaw=extractAppealBffSessionCookie(second.headers['Set-Cookie'].split(';')[0]);
 assert.notEqual(raw,secondRaw,'tokens must be cryptographically random per issuance');
 assert.notEqual(savedHash,firstHash,'hashed records must also differ');
 assert.equal(hashAppealBffSessionToken(secondRaw,pepper),savedHash);
});

test('prepared issuance refuses invalid params before a storage write',async()=>{
 const pepper=randomBytes(32),now=Date.UTC(2026,10,19,8);
 let writes=0;
 const deps={persistAuthorizedSession:async()=>{writes++;return true;}};
 for(const age of [0,-1,3601,1.5,NaN,Infinity,'3600',null] as unknown[]){
  await assert.rejects(issueAppealBffBrowserSession(deps,pepper,age as number,now),UnauthorizedException);
 }
 await assert.rejects(issueAppealBffBrowserSession(deps,randomBytes(16),60,now),UnauthorizedException);
 await assert.rejects(issueAppealBffBrowserSession(deps,pepper,60,-1),UnauthorizedException);
 await assert.rejects(issueAppealBffBrowserSession(deps,pepper,60,Number.NaN),UnauthorizedException);
 assert.equal(writes,0);
 for(const token of ['bad','a'.repeat(43),'a'.repeat(42)+'B',null])
  assert.throws(()=>hashAppealBffSessionToken(token,pepper),UnauthorizedException);
});

test('no cookie is returned when session persistence is denied or uncertain',async()=>{
 const pepper=randomBytes(32),now=Date.UTC(2026,10,19,8);
 for(const persistAuthorizedSession of [
  async()=>false,
  async()=>{throw new Error('database unavailable');},
  async()=>{throw new Error('commit outcome unknown');},
 ]){
  await assert.rejects(issueAppealBffBrowserSession({
   persistAuthorizedSession,
  },pepper,60,now));
 }
});
