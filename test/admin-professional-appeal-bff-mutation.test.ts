import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomBytes,randomUUID} from 'node:crypto';
import {UnauthorizedException} from '@nestjs/common';
import {issueAdminSessionToken} from '../src/modules/admin/admin-session-token.js';
import {issueAppealBffCsrf} from '../src/modules/admin/admin-professional-appeal-bff-csrf.js';
import {executeAppealBffMutation} from '../src/modules/admin/admin-professional-appeal-bff-mutation.js';

test('prepared appeal BFF binds live server session and CSRF before privileged forwarding',async()=>{
 const pepper=randomBytes(32),admin=issueAdminSessionToken(pepper);
 const sessionId=randomUUID(),appealId=randomUUID(),csrfKey=randomBytes(32);
 const origin='https://admin.example.kz',now=Date.UTC(2026,10,19,5,0,0);
 const cookie=randomBytes(32).toString('base64url');
 const csrf=issueAppealBffCsrf({
  sessionId,appealId,action:'assignment',origin,csrfKey,
 },now);
 const body={profile_id:randomUUID(),profile_version:1,reviewer_staff_id:randomUUID()};
 const base={
  action:'assignment' as const,appealId,body,
  sessionCookie:cookie,csrfToken:csrf,csrfKey,
  method:'POST',requestOrigin:origin,expectedOrigin:origin,
  fetchSite:'same-origin',contentType:'application/json',now,
 };
 let resolves=0,executions=0;
 let active=true;
 const session={sessionId,adminBearer:admin.token};
 const deps={
  resolveSession:async(input:string)=>{resolves++;return active&&input===cookie?session:null;},
  execute:async(action:string,bearer:string,aid:string,payload:unknown)=>{
   executions++;
   assert.equal(action,'assignment');assert.equal(bearer,admin.token);
   assert.equal(aid,appealId);assert.equal(payload,body);
   return {status:'assigned'};
  },
 };
 assert.deepEqual(await executeAppealBffMutation(base,deps),{status:'assigned'});
 assert.equal(executions,1);
 const deny=async(changes:Record<string,unknown>)=>{
  await assert.rejects(executeAppealBffMutation({...base,...changes},deps),UnauthorizedException);
 };
 await deny({sessionCookie:undefined});
 await deny({sessionCookie:'fake'});
 await deny({sessionCookie:'a'.repeat(513)});
 await deny({appealId:randomUUID()});
 await deny({appealId:'not-a-uuid'});
 await deny({action:'decision'});
 await deny({method:'GET'});
 await deny({fetchSite:'cross-site'});
 await deny({fetchSite:'same-site'});
 await deny({requestOrigin:'https://evil.example.kz'});
 await deny({requestOrigin:undefined});
 await deny({contentType:'text/plain'});
 await deny({csrfToken:'forged'});
 await deny({now:now+600_001});
 assert.equal(executions,1,'all invalid proofs must fail before forwarding');
 active=false;
 await deny({});
 active=true;
 assert.equal(executions,1,'revoked sessions must never forward');

 const wrongSession={...deps,resolveSession:async()=>{
  resolves++;return {sessionId:randomUUID(),adminBearer:admin.token};
 }};
 await assert.rejects(executeAppealBffMutation(base,wrongSession),UnauthorizedException);
 const noBearer={...deps,resolveSession:async()=>{
  resolves++;return {sessionId,adminBearer:'browser supplied'};
 }};
 await assert.rejects(executeAppealBffMutation(base,noBearer),UnauthorizedException);
 assert.equal(executions,1);

 // With a newly rotated session ID the old CSRF proof is no longer valid.
 const rotatedId=randomUUID();
 const rotated={...deps,resolveSession:async()=>{
  resolves++;return {sessionId:rotatedId,adminBearer:admin.token};
 }};
 await assert.rejects(executeAppealBffMutation(base,rotated),UnauthorizedException);
 const fresh=issueAppealBffCsrf({
  sessionId:rotatedId,appealId,action:'assignment',origin,csrfKey,
 },now);
 assert.deepEqual(await executeAppealBffMutation({...base,csrfToken:fresh},rotated),
  {status:'assigned'});
 assert.equal(executions,2,'fresh CSRF for valid rotated session may forward');
 assert.ok(resolves>=4);
});

test('prepared BFF refuses insecure caller-controlled fields before session resolution',async()=>{
 let resolved=0;
 const deps={
  resolveSession:async()=>{resolved++;return null;},
  execute:async()=>{throw Error('must not execute');},
 };
 const base={
  action:'decision' as const,appealId:randomUUID(),body:{},
  sessionCookie:randomBytes(32).toString('base64url'),
  csrfToken:'invalid',csrfKey:randomBytes(32),
  method:'POST',requestOrigin:'https://admin.example.kz',
  expectedOrigin:'https://admin.example.kz',
  fetchSite:'same-origin',contentType:'application/json',
 };
 for(const patch of [
  {sessionCookie:'abc'},{sessionCookie:'a'.repeat(513)},
  {sessionCookie:'a=b'},{method:'OPTIONS'},
  {requestOrigin:'null'},{expectedOrigin:'https://attacker.example'},
  {appealId:'bad'},{action:'export'},
 ]){
  await assert.rejects(executeAppealBffMutation({...base,...patch} as typeof base,deps),
   UnauthorizedException);
 }
 assert.equal(resolved,0);
});
