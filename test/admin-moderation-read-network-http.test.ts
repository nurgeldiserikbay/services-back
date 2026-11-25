import 'reflect-metadata';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomBytes,randomUUID} from 'node:crypto';
import {NestFactory} from '@nestjs/core';
import type {INestApplication} from '@nestjs/common';
import type {PoolClient} from 'pg';
import {AppModule} from '../src/modules/app.module.js';
import {DatabasePool} from '../src/platform/database/database.pool.js';
import {issueAdminSessionToken,hashAdminSessionToken}
 from '../src/modules/admin/admin-session-token.js';

test('admin moderation GET real HTTP requires current scoped MFA grant and sends redacted uncached response',async()=>{
 const before={
  feature:process.env.SERVICES_ENABLE_PLATFORM_MODERATION_HTTP,
  key:process.env.PLATFORM_ADMIN_SESSION_HMAC_KEY,
 };
 const pepper=randomBytes(32),token=issueAdminSessionToken(pepper).token;
 const scope='organization:'+randomUUID(),caseId=randomUUID(),userId=randomUUID();
 const now=Date.now();
 let app:INestApplication|undefined,dbCalls=0,caseQueries=0;
 try{
  delete process.env.SERVICES_ENABLE_PLATFORM_MODERATION_HTTP;
  process.env.PLATFORM_ADMIN_SESSION_HMAC_KEY=pepper.toString('base64');
  app=await NestFactory.create(AppModule,{logger:false});
  const db=app.get(DatabasePool);
  db.transaction=async <T>(work:(client:PoolClient)=>Promise<T>):Promise<T>=>{
   dbCalls++;
   const client={query:async(sql:string,params:unknown[])=>{
    if(sql.includes('FROM platform_admin_sessions')&&!sql.includes('FROM platform_moderation_cases')){
     assert.equal(params[0],hashAdminSessionToken(token,pepper));
     return {rows:[{user_id:userId,role:'auditor',
      expires_at:new Date(now+60000),mfa_verified_at:new Date(now-1000),
      scope}]};
    }
    caseQueries++;
    assert.match(sql,/FROM platform_moderation_cases/);
    assert.match(sql,/current_session.revoked_at IS NULL/);
    assert.deepEqual(params[0],[scope]);
    assert.equal(params[1],userId);
    assert.equal(params[2],hashAdminSessionToken(token,pepper));
    return {rows:[{id:caseId,resource_scope:scope,
     subject_kind:'review',state:'triage',created_at:new Date(now-2000)}]};
   }} as unknown as PoolClient;
   return work(client);
  };
  app.setGlobalPrefix('v1');
  await app.listen(0,'127.0.0.1');
  const address=app.getHttpServer().address();
  assert.ok(address&&typeof address!=='string');
  const url=`http://127.0.0.1:${address.port}/v1/admin/moderation/cases`;
  const get=(authorization?:string)=>fetch(url,{
   method:'GET',redirect:'manual',
   headers:authorization?{Authorization:authorization}:{},
  });
  const valid='Bearer '+token;
  const disabled=await get(valid);
  assert.equal(disabled.status,401);
  assert.equal(dbCalls,0);
  process.env.SERVICES_ENABLE_PLATFORM_MODERATION_HTTP='enabled';
  for(const bad of [undefined,'Basic '+token,'Bearer bad','Bearer '+token+', Bearer '+token]){
   const denied=await get(bad);
   assert.equal(denied.status,401);
   assert.equal(dbCalls,0);
   assert.ok(!(await denied.text()).includes(token));
  }
  const good=await get(valid);
  assert.equal(good.status,200);
  assert.match(good.headers.get('cache-control')??'',/no-store/);
  assert.match(good.headers.get('x-robots-tag')??'',/noindex/);
  assert.equal(good.headers.get('x-content-type-options'),'nosniff');
  assert.equal(good.headers.get('set-cookie'),null);
  assert.equal(good.headers.get('vary'),'Authorization');
  const response=await good.json() as {items:unknown[]};
  assert.deepEqual(response,{items:[{id:caseId,subjectKind:'review',
   state:'triage',createdAt:new Date(now-2000).toISOString()}]});
  for(const secret of [token,hashAdminSessionToken(token,pepper),userId,scope]){
   assert.equal(JSON.stringify(response).includes(secret),false);
  }
  assert.equal(dbCalls,1);
  assert.equal(caseQueries,1);
 }finally{
  await app?.close();
  if(before.feature===undefined)delete process.env.SERVICES_ENABLE_PLATFORM_MODERATION_HTTP;
  else process.env.SERVICES_ENABLE_PLATFORM_MODERATION_HTTP=before.feature;
  if(before.key===undefined)delete process.env.PLATFORM_ADMIN_SESSION_HMAC_KEY;
  else process.env.PLATFORM_ADMIN_SESSION_HMAC_KEY=before.key;
 }
});
