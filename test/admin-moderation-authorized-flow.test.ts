import assert from 'node:assert/strict';
import {test} from 'node:test';
import {PlatformModerationReadService} from '../src/modules/admin/admin-moderation-read.service.js';
import {issueAdminSessionToken,hashAdminSessionToken} from '../src/modules/admin/admin-session-token.js';
import {DatabasePool} from '../src/platform/database/database.pool.js';

test('moderation read returns only cases within fresh MFA-verified DB grants',async()=>{
 const oldFlag=process.env.SERVICES_ENABLE_PLATFORM_MODERATION_HTTP;
 const oldKey=process.env.PLATFORM_ADMIN_SESSION_HMAC_KEY;
 const oldNow=Date.now;
 const fixed=Date.parse('2026-11-11T10:00:00Z');
 const pepper=Buffer.alloc(32,21);
 const {token}=issueAdminSessionToken(pepper);
 const scope='organization:11111111-1111-4111-8111-111111111111';
 const caseId='22222222-2222-4222-8222-222222222222';
 try{
  process.env.SERVICES_ENABLE_PLATFORM_MODERATION_HTTP='enabled';
  process.env.PLATFORM_ADMIN_SESSION_HMAC_KEY=pepper.toString('base64');
  Date.now=()=>fixed;
  let calls=0;
  const db={async transaction<T>(work:(client:{query:(sql:string,params:unknown[])=>Promise<{rows:unknown[]}>})=>Promise<T>):Promise<T>{
   return work({async query(sql,params){
    calls++;
    if(calls===1){
     assert.match(sql,/platform_admin_sessions/);
     assert.deepEqual(params,[hashAdminSessionToken(token,pepper),fixed]);
     return {rows:[{user_id:'33333333-3333-4333-8333-333333333333',
      role:'admin',expires_at:new Date(fixed+60_000),
      mfa_verified_at:new Date(fixed-60_000),scope}]};
    }
    assert.match(sql,/platform_moderation_cases/);
    assert.deepEqual(params,[[scope],'33333333-3333-4333-8333-333333333333',hashAdminSessionToken(token,pepper),fixed]);
    return {rows:[{id:caseId,resource_scope:scope,subject_kind:'organization',
      state:'triage',created_at:new Date(fixed-30_000)}]};
   }});
  }};
  const service=new PlatformModerationReadService(db as unknown as DatabasePool);
  assert.deepEqual(await service.list('Bearer '+token),{items:[{
   id:caseId,subjectKind:'organization',state:'triage',
   createdAt:new Date(fixed-30_000).toISOString(),
  }]});
  assert.equal(calls,2);
 }finally{
  Date.now=oldNow;
  if(oldFlag===undefined)delete process.env.SERVICES_ENABLE_PLATFORM_MODERATION_HTTP;
  else process.env.SERVICES_ENABLE_PLATFORM_MODERATION_HTTP=oldFlag;
  if(oldKey===undefined)delete process.env.PLATFORM_ADMIN_SESSION_HMAC_KEY;
  else process.env.PLATFORM_ADMIN_SESSION_HMAC_KEY=oldKey;
 }
});

test('moderation read rejects revoked or expired admin sessions before querying cases',async()=>{
 const oldFlag=process.env.SERVICES_ENABLE_PLATFORM_MODERATION_HTTP;
 const oldKey=process.env.PLATFORM_ADMIN_SESSION_HMAC_KEY;
 const pepper=Buffer.alloc(32,17);
 const {token}=issueAdminSessionToken(pepper);
 try{
  process.env.SERVICES_ENABLE_PLATFORM_MODERATION_HTTP='enabled';
  process.env.PLATFORM_ADMIN_SESSION_HMAC_KEY=pepper.toString('base64');
  let calls=0;
  const db={async transaction<T>(work:(client:{query:()=>Promise<{rows:unknown[]}>})=>Promise<T>):Promise<T>{
   return work({async query(){calls++;return {rows:[]};}});
  }};
  const service=new PlatformModerationReadService(db as unknown as DatabasePool);
  await assert.rejects(service.list('Bearer '+token),{name:'UnauthorizedException'});
  assert.equal(calls,1);
 }finally{
  if(oldFlag===undefined)delete process.env.SERVICES_ENABLE_PLATFORM_MODERATION_HTTP;
  else process.env.SERVICES_ENABLE_PLATFORM_MODERATION_HTTP=oldFlag;
  if(oldKey===undefined)delete process.env.PLATFORM_ADMIN_SESSION_HMAC_KEY;
  else process.env.PLATFORM_ADMIN_SESSION_HMAC_KEY=oldKey;
 }
});

test('moderation read denies stale MFA even when the session and scope exist',async()=>{
 const oldFlag=process.env.SERVICES_ENABLE_PLATFORM_MODERATION_HTTP;
 const oldKey=process.env.PLATFORM_ADMIN_SESSION_HMAC_KEY;
 const oldNow=Date.now;
 const fixed=Date.parse('2026-11-11T10:00:00Z');
 const pepper=Buffer.alloc(32,19);
 const {token}=issueAdminSessionToken(pepper);
 try{
  process.env.SERVICES_ENABLE_PLATFORM_MODERATION_HTTP='enabled';
  process.env.PLATFORM_ADMIN_SESSION_HMAC_KEY=pepper.toString('base64');
  Date.now=()=>fixed;
  let queries=0;
  const db={async transaction<T>(work:(client:{query:()=>Promise<{rows:unknown[]}>})=>Promise<T>):Promise<T>{
   return work({async query(){
    queries++;
    assert.equal(queries,1,'moderation data must not be queried after stale MFA');
    return {rows:[{
     user_id:'33333333-3333-4333-8333-333333333333',
     role:'admin',expires_at:new Date(fixed+60_000),
     mfa_verified_at:new Date(fixed-16*60_000),
     scope:'organization:11111111-1111-4111-8111-111111111111',
    }]};
   }});
  }};
  const service=new PlatformModerationReadService(db as unknown as DatabasePool);
  await assert.rejects(service.list('Bearer '+token),{name:'UnauthorizedException'});
  assert.equal(queries,1);
 }finally{
  Date.now=oldNow;
  if(oldFlag===undefined)delete process.env.SERVICES_ENABLE_PLATFORM_MODERATION_HTTP;
  else process.env.SERVICES_ENABLE_PLATFORM_MODERATION_HTTP=oldFlag;
  if(oldKey===undefined)delete process.env.PLATFORM_ADMIN_SESSION_HMAC_KEY;
  else process.env.PLATFORM_ADMIN_SESSION_HMAC_KEY=oldKey;
 }
});

test('moderation read returns no cases and skips data query without explicit scope grants',async()=>{
 const oldFlag=process.env.SERVICES_ENABLE_PLATFORM_MODERATION_HTTP;
 const oldKey=process.env.PLATFORM_ADMIN_SESSION_HMAC_KEY;
 const oldNow=Date.now;
 const fixed=Date.parse('2026-11-11T10:00:00Z');
 const pepper=Buffer.alloc(32,23);
 const {token}=issueAdminSessionToken(pepper);
 try{
  process.env.SERVICES_ENABLE_PLATFORM_MODERATION_HTTP='enabled';
  process.env.PLATFORM_ADMIN_SESSION_HMAC_KEY=pepper.toString('base64');
  Date.now=()=>fixed;
  let queries=0;
  const db={async transaction<T>(work:(client:{query:()=>Promise<{rows:unknown[]}>})=>Promise<T>):Promise<T>{
   return work({async query(){
    queries++;
    assert.equal(queries,1,'no moderation rows may be queried without scope grants');
    return {rows:[{
     user_id:'33333333-3333-4333-8333-333333333333',
     role:'owner',expires_at:new Date(fixed+60_000),
     mfa_verified_at:new Date(fixed-60_000),scope:null,
    }]};
   }});
  }};
  const service=new PlatformModerationReadService(db as unknown as DatabasePool);
  await assert.rejects(service.list('Bearer '+token),{name:'UnauthorizedException'});
  assert.equal(queries,1);
 }finally{
  Date.now=oldNow;
  if(oldFlag===undefined)delete process.env.SERVICES_ENABLE_PLATFORM_MODERATION_HTTP;
  else process.env.SERVICES_ENABLE_PLATFORM_MODERATION_HTTP=oldFlag;
  if(oldKey===undefined)delete process.env.PLATFORM_ADMIN_SESSION_HMAC_KEY;
  else process.env.PLATFORM_ADMIN_SESSION_HMAC_KEY=oldKey;
 }
});

test('moderation read denies an out-of-scope row even when SQL returns it',async()=>{
 const oldFlag=process.env.SERVICES_ENABLE_PLATFORM_MODERATION_HTTP;
 const oldKey=process.env.PLATFORM_ADMIN_SESSION_HMAC_KEY;
 const oldNow=Date.now;
 const fixed=Date.parse('2026-11-11T10:00:00Z');
 const pepper=Buffer.alloc(32,25);
 const {token}=issueAdminSessionToken(pepper);
 const allowed='organization:11111111-1111-4111-8111-111111111111';
 const forbidden='organization:44444444-4444-4444-8444-444444444444';
 try{
  process.env.SERVICES_ENABLE_PLATFORM_MODERATION_HTTP='enabled';
  process.env.PLATFORM_ADMIN_SESSION_HMAC_KEY=pepper.toString('base64');
  Date.now=()=>fixed;
  let queries=0;
  const db={async transaction<T>(work:(client:{query:(sql:string,params:unknown[])=>Promise<{rows:unknown[]}>})=>Promise<T>):Promise<T>{
   return work({async query(sql,params){
    queries++;
    if(queries===1)return {rows:[{
     user_id:'33333333-3333-4333-8333-333333333333',
     role:'admin',expires_at:new Date(fixed+60_000),
     mfa_verified_at:new Date(fixed-60_000),scope:allowed,
    }]};
    assert.match(sql,/platform_moderation_cases/);
    assert.deepEqual(params,[[allowed],'33333333-3333-4333-8333-333333333333',hashAdminSessionToken(token,pepper),fixed]);
    return {rows:[{id:'22222222-2222-4222-8222-222222222222',
     resource_scope:forbidden,subject_kind:'organization',
     state:'triage',created_at:new Date(fixed-30_000)}]};
   }});
  }};
  const service=new PlatformModerationReadService(db as unknown as DatabasePool);
  await assert.rejects(service.list('Bearer '+token),{name:'UnauthorizedException'});
  assert.equal(queries,2);
 }finally{
  Date.now=oldNow;
  if(oldFlag===undefined)delete process.env.SERVICES_ENABLE_PLATFORM_MODERATION_HTTP;
  else process.env.SERVICES_ENABLE_PLATFORM_MODERATION_HTTP=oldFlag;
  if(oldKey===undefined)delete process.env.PLATFORM_ADMIN_SESSION_HMAC_KEY;
  else process.env.PLATFORM_ADMIN_SESSION_HMAC_KEY=oldKey;
 }
});
