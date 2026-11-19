import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomBytes,randomUUID} from 'node:crypto';
import {createAppealBffHashSessionResolver} from '../src/modules/admin/admin-professional-appeal-bff-session-resolver.js';
import {hashAppealBffSessionToken} from '../src/modules/admin/admin-professional-appeal-bff-session-issuance.js';
import {issueAdminSessionToken} from '../src/modules/admin/admin-session-token.js';

test('resolver hashes browser proof before authoritative lookup and verifies live session',async()=>{
 const pepper=randomBytes(32),cookie=randomBytes(32).toString('base64url');
 const sessionId=randomUUID(),now=Date.UTC(2026,10,19,8);
 const bearer=issueAdminSessionToken(randomBytes(32)).token;
 let lookup=0,authority=0;
 const resolver=createAppealBffHashSessionResolver({
  findSessionByHash:async(hash)=>{
   lookup++;assert.equal(hash,hashAppealBffSessionToken(cookie,pepper));
   assert.notEqual(hash,cookie);return {sessionId,expiresAt:now+60_000,revokedAt:null};
  },
  resolvePrivilegedBearer:async(id)=>{
   authority++;assert.equal(id,sessionId);return bearer;
  },
 },pepper,()=>now);
 assert.deepEqual(await resolver(cookie),{sessionId,adminBearer:bearer});
 assert.equal(lookup,1);assert.equal(authority,1);
 assert.equal(await resolver('bad'),null);
 assert.equal(lookup,1,'invalid browser token never reaches storage');
});

test('expired, revoked and malformed browser sessions never resolve privilege',async()=>{
 const pepper=randomBytes(32),cookie=randomBytes(32).toString('base64url');
 const sessionId=randomUUID(),now=Date.UTC(2026,10,19,8);
 let authority=0;
 const rows=[
  null,{sessionId,expiresAt:now,revokedAt:null},
  {sessionId,expiresAt:now-1,revokedAt:null},
  {sessionId,expiresAt:now+1000,revokedAt:now-1},
  {sessionId:'bad',expiresAt:now+1000,revokedAt:null},
  {sessionId,expiresAt:Number.NaN,revokedAt:null},
  {sessionId,expiresAt:now+1000,revokedAt:undefined},
 ];
 let index=0;
 const resolver=createAppealBffHashSessionResolver({
  findSessionByHash:async()=>rows[index++] as {sessionId:string;expiresAt:number;revokedAt:number|null}|null,
  resolvePrivilegedBearer:async()=>{authority++;return 'forbidden';},
 },pepper,()=>now);
 for(const row of rows)assert.equal(await resolver(cookie),null,'reject '+JSON.stringify(row));
 assert.equal(authority,0);
});

test('authorization and storage failures fail closed and cannot manufacture a valid bearer',async()=>{
 const pepper=randomBytes(32),cookie=randomBytes(32).toString('base64url');
 const sessionId=randomUUID(),now=Date.UTC(2026,10,19,8);
 const row={sessionId,expiresAt:now+5000,revokedAt:null};
 for(const invalid of [null,'bad','Bearer '+issueAdminSessionToken(pepper).token]){
  const resolver=createAppealBffHashSessionResolver({
   findSessionByHash:async()=>row,
   resolvePrivilegedBearer:async()=>invalid,
  },pepper,()=>now);
  assert.equal(await resolver(cookie),null);
 }
 const badStore=createAppealBffHashSessionResolver({
  findSessionByHash:async()=>{throw new Error('store unavailable');},
  resolvePrivilegedBearer:async()=>null,
 },pepper,()=>now);
 await assert.rejects(badStore(cookie),/store unavailable/);
 const badAuthority=createAppealBffHashSessionResolver({
  findSessionByHash:async()=>row,
  resolvePrivilegedBearer:async()=>{throw new Error('grant lookup failed');},
 },pepper,()=>now);
 await assert.rejects(badAuthority(cookie),/grant lookup failed/);
});

test('async privilege lookup must not authorize a session expired during await',async()=>{
 const pepper=randomBytes(32),cookie=randomBytes(32).toString('base64url');
 const sessionId=randomUUID(),start=Date.UTC(2026,10,19,8);
 const bearer=issueAdminSessionToken(randomBytes(32)).token;
 for(const advanced of [start+1000,start+1001]){
  let clock=start;
  const resolver=createAppealBffHashSessionResolver({
   findSessionByHash:async()=>({sessionId,expiresAt:start+1000,revokedAt:null}),
   resolvePrivilegedBearer:async()=>{
    await Promise.resolve();clock=advanced;return bearer;
   },
  },pepper,()=>clock);
  assert.equal(await resolver(cookie),null,'never return expired privilege');
 }
});

test('async authority result is rejected when the clock moves backwards or corrupts',async()=>{
 const pepper=randomBytes(32),cookie=randomBytes(32).toString('base64url');
 const sessionId=randomUUID(),start=Date.UTC(2026,10,19,8);
 const bearer=issueAdminSessionToken(randomBytes(32)).token;
 for(const advanced of [start-1,Number.NaN]){
  let clock=start;
  const resolver=createAppealBffHashSessionResolver({
   findSessionByHash:async()=>({sessionId,expiresAt:start+1000,revokedAt:null}),
   resolvePrivilegedBearer:async()=>{clock=advanced;return bearer;},
  },pepper,()=>clock);
  assert.equal(await resolver(cookie),null);
 }
});
