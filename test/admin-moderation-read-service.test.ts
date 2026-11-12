import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {UnauthorizedException} from '@nestjs/common';
import {issueAdminSessionToken,hashAdminSessionToken} from '../src/modules/admin/admin-session-token.js';
import {PlatformModerationReadService,validateModerationCaseRows} from '../src/modules/admin/admin-moderation-read.service.js';

const key=randomBytes(32);
const token=issueAdminSessionToken(key).token;
const userId=randomUUID(),scope='organization:'+randomUUID();
const savedFlag=process.env.SERVICES_ENABLE_PLATFORM_MODERATION_HTTP;
const savedKey=process.env.PLATFORM_ADMIN_SESSION_HMAC_KEY;
function restore(){
 if(savedFlag===undefined)delete process.env.SERVICES_ENABLE_PLATFORM_MODERATION_HTTP;
 else process.env.SERVICES_ENABLE_PLATFORM_MODERATION_HTTP=savedFlag;
 if(savedKey===undefined)delete process.env.PLATFORM_ADMIN_SESSION_HMAC_KEY;
 else process.env.PLATFORM_ADMIN_SESSION_HMAC_KEY=savedKey;
}
test('moderation read stays closed unless explicitly enabled',async()=>{
 try{
  delete process.env.SERVICES_ENABLE_PLATFORM_MODERATION_HTTP;
  let queried=false;
  const service=new PlatformModerationReadService({
   transaction:async()=>{queried=true;return {items:[]};}
  } as never);
  await assert.rejects(service.list('Bearer '+token),UnauthorizedException);
  assert.equal(queried,false);
 }finally{restore();}
});
test('moderation read rejects missing or malformed bearer before querying',async()=>{
 try{
  process.env.SERVICES_ENABLE_PLATFORM_MODERATION_HTTP='enabled';
  let queried=false;
  const service=new PlatformModerationReadService({
   transaction:async()=>{queried=true;return {items:[]};}
  } as never);
  for(const header of [undefined,'Bearer invalid','Basic '+token]){
   await assert.rejects(service.list(header),UnauthorizedException);
  }
  assert.equal(queried,false);
 }finally{restore();}
});
test('moderation read returns only redacted cases within active grants',async()=>{
 try{
  process.env.SERVICES_ENABLE_PLATFORM_MODERATION_HTTP='enabled';
  process.env.PLATFORM_ADMIN_SESSION_HMAC_KEY=key.toString('base64');
  const now=Date.now();
  const id=randomUUID();
  const db={
   transaction:async(work:(client:unknown)=>Promise<unknown>)=>work({
    query:async(sql:string,params:unknown[])=>{
     if(sql.includes('FROM platform_admin_sessions')){
      assert.match(String(params[0]),/^[0-9a-f]{64}$/);
      assert.equal(params[0]===token,false);
      return {rows:[{user_id:userId,role:'auditor',
       expires_at:new Date(now+60000),mfa_verified_at:new Date(now-1000),
       scope}]};
     }
     assert.match(sql,/resource_scope=ANY/);
     assert.match(sql,/current_session\.revoked_at IS NULL/);
     assert.match(sql,/current_session\.mfa_verified_at/);
     assert.match(sql,/account_row\.status='ACTIVE'/);
     assert.equal(params.length,4);
     assert.deepEqual(params[0],[scope]);
     assert.equal(params[1],userId);
     assert.equal(params[2],hashAdminSessionToken(token,key));
     assert.ok(typeof params[3]==='number');
     assert.ok(Math.abs((params[3] as number)-now)<5000);
     return {rows:[{id,resource_scope:scope,subject_kind:'review',
      state:'triage',created_at:new Date(now-1000)}]};
    }
   })
  };
  const service=new PlatformModerationReadService(db as never);
  const result=await service.list('Bearer '+token);
  assert.deepEqual(result,{items:[{id,subjectKind:'review',
   state:'triage',createdAt:new Date(now-1000).toISOString()}]});
 }finally{restore();}
});

test('moderation read denies stale MFA without loading case data',async()=>{
 try{
  process.env.SERVICES_ENABLE_PLATFORM_MODERATION_HTTP='enabled';
  process.env.PLATFORM_ADMIN_SESSION_HMAC_KEY=key.toString('base64');
  const now=Date.now();
  let caseQueries=0;
  const db={transaction:async(work:(client:unknown)=>Promise<unknown>)=>work({
   query:async(sql:string)=>{
    if(sql.includes('FROM platform_admin_sessions'))
     return {rows:[{user_id:userId,role:'auditor',
      expires_at:new Date(now+60000),mfa_verified_at:new Date(now-16*60000),
      scope}]};
    caseQueries++;
    return {rows:[]};
   }
  })};
  const service=new PlatformModerationReadService(db as never);
  await assert.rejects(service.list('Bearer '+token),UnauthorizedException);
  assert.equal(caseQueries,0);
 }finally{restore();}
});

test('moderation read denies missing or malformed admin HMAC configuration',async()=>{
 try{
  process.env.SERVICES_ENABLE_PLATFORM_MODERATION_HTTP='enabled';
  let queried=false;
  const service=new PlatformModerationReadService({
   transaction:async()=>{queried=true;return {items:[]};}
  } as never);
  for(const secret of [undefined,'invalid','AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA']){
   if(secret===undefined)delete process.env.PLATFORM_ADMIN_SESSION_HMAC_KEY;
   else process.env.PLATFORM_ADMIN_SESSION_HMAC_KEY=secret;
   await assert.rejects(service.list('Bearer '+token),UnauthorizedException);
  }
  assert.equal(queried,false);
 }finally{restore();}
});

test('moderation read does not disclose database error details',async()=>{
 try{
  process.env.SERVICES_ENABLE_PLATFORM_MODERATION_HTTP='enabled';
  process.env.PLATFORM_ADMIN_SESSION_HMAC_KEY=key.toString('base64');
  const service=new PlatformModerationReadService({
   transaction:async()=>{throw new Error('database host and SQL details');}
  } as never);
  await assert.rejects(service.list('Bearer '+token),(error:unknown)=>{
   assert.ok(error instanceof UnauthorizedException);
   assert.doesNotMatch(String(error),/database host and SQL details/);
   return true;
  });
 }finally{restore();}
});

test('moderation response validation rejects unauthorized scopes and malformed rows',()=>{
 const id=randomUUID(),created_at=new Date();
 const valid={id,resource_scope:scope,subject_kind:'review',state:'triage',created_at};
 assert.deepEqual(validateModerationCaseRows([valid],new Set([scope])),[
  {id,subjectKind:'review',state:'triage',createdAt:created_at.toISOString()}
 ]);
 for(const invalid of [
  {...valid,resource_scope:'organization:'+randomUUID()},
  {...valid,resource_scope:null},
  {...valid,subject_kind:'unknown'},
  {...valid,state:'unknown'},
  {...valid,created_at:new Date('invalid')},
  {...valid,id:'invalid'},
 ]){
  assert.throws(()=>validateModerationCaseRows([invalid] as never,new Set([scope])),
   UnauthorizedException);
 }
 assert.throws(()=>validateModerationCaseRows([valid,valid],new Set([scope])),
  UnauthorizedException);
 assert.throws(()=>validateModerationCaseRows(Array.from({length:51},()=>valid),new Set([scope])),
  UnauthorizedException);
});

test('moderation read denies session expiry between authentication and case query',async()=>{
 const originalNow=Date.now;
 try{
  process.env.SERVICES_ENABLE_PLATFORM_MODERATION_HTTP='enabled';
  process.env.PLATFORM_ADMIN_SESSION_HMAC_KEY=key.toString('base64');
  const initial=1_800_000_000_000;
  let calls=0,caseQueries=0;
  Date.now=()=>initial+(calls++===0?0:2000);
  const db={transaction:async(work:(client:unknown)=>Promise<unknown>)=>work({
   query:async(sql:string)=>{
    if(sql.includes('FROM platform_admin_sessions'))
     return {rows:[{user_id:userId,role:'auditor',
      expires_at:new Date(initial+1000),mfa_verified_at:new Date(initial-1000),
      scope}]};
    caseQueries++;
    return {rows:[]};
   }
  })};
  await assert.rejects(
   new PlatformModerationReadService(db as never).list('Bearer '+token),
   UnauthorizedException);
  assert.equal(caseQueries,0);
 }finally{Date.now=originalNow;restore();}
});

test('moderation read denies a valid session without a moderation.read grant',async()=>{
 try{
  process.env.SERVICES_ENABLE_PLATFORM_MODERATION_HTTP='enabled';
  process.env.PLATFORM_ADMIN_SESSION_HMAC_KEY=key.toString('base64');
  const now=Date.now();
  let caseQueries=0;
  const db={transaction:async(work:(client:unknown)=>Promise<unknown>)=>work({
   query:async(sql:string)=>{
    if(sql.includes('FROM platform_admin_sessions'))
     return {rows:[{user_id:userId,role:'auditor',
      expires_at:new Date(now+60000),mfa_verified_at:new Date(now-1000),
      scope:null}]};
    caseQueries++;
    return {rows:[]};
   }
  })};
  await assert.rejects(
   new PlatformModerationReadService(db as never).list('Bearer '+token),
   UnauthorizedException);
  assert.equal(caseQueries,0);
 }finally{restore();}
});

test('moderation read denies MFA expiry between authentication and case query',async()=>{
 const originalNow=Date.now;
 try{
  process.env.SERVICES_ENABLE_PLATFORM_MODERATION_HTTP='enabled';
  process.env.PLATFORM_ADMIN_SESSION_HMAC_KEY=key.toString('base64');
  const initial=1_800_000_000_000;
  let calls=0,caseQueries=0;
  Date.now=()=>initial+(calls++===0?0:2000);
  const db={transaction:async(work:(client:unknown)=>Promise<unknown>)=>work({
   query:async(sql:string)=>{
    if(sql.includes('FROM platform_admin_sessions'))
     return {rows:[{user_id:userId,role:'auditor',
      expires_at:new Date(initial+60000),
      mfa_verified_at:new Date(initial-15*60*1000+1000),scope}]};
    caseQueries++;
    return {rows:[]};
   }
  })};
  await assert.rejects(
   new PlatformModerationReadService(db as never).list('Bearer '+token),
   UnauthorizedException);
  assert.equal(caseQueries,0);
 }finally{Date.now=originalNow;restore();}
});
