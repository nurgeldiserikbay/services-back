import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {UnauthorizedException} from '@nestjs/common';
import {issueAdminSessionToken} from '../src/modules/admin/admin-session-token.js';
import {PlatformModerationReadService} from '../src/modules/admin/admin-moderation-read.service.js';

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
     assert.deepEqual(params,[[scope]]);
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
  for(const secret of [undefined,'invalid','AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=']){
   if(secret===undefined)delete process.env.PLATFORM_ADMIN_SESSION_HMAC_KEY;
   else process.env.PLATFORM_ADMIN_SESSION_HMAC_KEY=secret;
   await assert.rejects(service.list('Bearer '+token),UnauthorizedException);
  }
  assert.equal(queried,false);
 }finally{restore();}
});
