import 'reflect-metadata';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomBytes,randomUUID} from 'node:crypto';
import {NestFactory} from '@nestjs/core';
import type {INestApplication} from '@nestjs/common';
import type {PoolClient} from 'pg';
import {AppModule} from '../src/modules/app.module.js';
import {DatabasePool} from '../src/platform/database/database.pool.js';
import {issueAdminSessionToken} from '../src/modules/admin/admin-session-token.js';

/**
 * Real HTTP → Nest controller → session resolver → permission policy → redacted DTO.
 * Fake SQL rows are injected at the DB adapter boundary so the test cannot touch
 * real/staging admin accounts. PostgreSQL queries and persistence have separate tests.
 * This enables the flag only inside the test worker and never deploys it.
 */
test('admin HTTP honors live scope, MFA freshness and session revocation',async()=>{
 const oldFlag=process.env.SERVICES_ENABLE_PLATFORM_MODERATION_HTTP;
 const oldKey=process.env.PLATFORM_ADMIN_SESSION_HMAC_KEY;
 const pepper=randomBytes(32);
 const {token,tokenHash}=issueAdminSessionToken(pepper);
 const allowedScope='organization:'+randomUUID();
 const deniedScope='organization:'+randomUUID();
 const caseId=randomUUID();
 const userId=randomUUID();
 let revoked=false;
 let staleMfa=false;
 let noGrants=false;
 let malformedSessionReply=false;
 let injectOutOfScopeRow=false;
 let caseQueries=0;
 let app:INestApplication|undefined;
 try{
  process.env.SERVICES_ENABLE_PLATFORM_MODERATION_HTTP='enabled';
  process.env.PLATFORM_ADMIN_SESSION_HMAC_KEY=pepper.toString('base64');
  app=await NestFactory.create(AppModule,{logger:false});
  const db=app.get(DatabasePool);
  db.transaction=async <T>(work:(client:PoolClient)=>Promise<T>):Promise<T>=>{
   const client={query:async(sql:string,values:unknown[])=>{
    if(sql.includes('FROM platform_admin_sessions')){
     assert.match(sql,/session\.revoked_at IS NULL/);
     if(malformedSessionReply)return {rows:null};
     if(revoked||values[0]!==tokenHash)return {rows:[]};
     return {rows:[{
      user_id:userId,role:'auditor',
      expires_at:new Date(Date.now()+60_000),
      mfa_verified_at:new Date(Date.now()-(staleMfa?20*60_000:1_000)),
      scope:noGrants?null:allowedScope,
     }]};
    }
    if(sql.includes('FROM platform_moderation_cases')){
     caseQueries++;
     assert.equal(values[0] instanceof Array,true);
     assert.deepEqual(values,[ [allowedScope],userId,tokenHash,values[3] ]);
     assert.equal(typeof values[3],'number');
     assert.match(sql,/resource_scope=ANY\(\$1::varchar\[\]\)/);
     return {rows:[{
      id:caseId,resource_scope:injectOutOfScopeRow?deniedScope:allowedScope,subject_kind:'review',
      state:'triage',created_at:new Date('2026-11-09T09:00:00.000Z'),
      email:'never-return@example.test',
     }]};
    }
    throw new Error('unexpected query');
   }} as unknown as PoolClient;
   return work(client);
  };
  app.setGlobalPrefix('v1');
  await app.listen(0,'127.0.0.1');
  const address=app.getHttpServer().address();
  assert.ok(address&&typeof address!=='string');
  const url=`http://127.0.0.1:${address.port}/v1/admin/moderation/cases`;
  const get=(bearer:string)=>fetch(url,{headers:{Authorization:'Bearer '+bearer},redirect:'manual'});
  const valid=await get(token);
  assert.equal(valid.status,200);
  assert.match(valid.headers.get('cache-control')??'',/no-store/);
  assert.match(valid.headers.get('x-robots-tag')??'',/noindex/);
  assert.deepEqual(await valid.json(),{items:[{
   id:caseId,subjectKind:'review',state:'triage',
   createdAt:'2026-11-09T09:00:00.000Z',
  }]});
  assert.equal(caseQueries,1);

  // A broken/malicious DB adapter must not cause cross-scope data disclosure.
  injectOutOfScopeRow=true;
  const crossScope=await get(token);
  assert.equal(crossScope.status,401);
  assert.ok(!(await crossScope.text()).includes(caseId));
  assert.equal(caseQueries,2);
  injectOutOfScopeRow=false;

  malformedSessionReply=true;
  const malformed=await get(token);
  assert.equal(malformed.status,401);
  assert.ok(!(await malformed.text()).includes(token));
  assert.equal(caseQueries,2);
  malformedSessionReply=false;

  const wrong=await get(randomBytes(32).toString('base64url'));
  assert.equal(wrong.status,401);
  assert.equal(caseQueries,2);

  noGrants=true;
  const missingScope=await get(token);
  assert.equal(missingScope.status,401);
  assert.equal(caseQueries,2);
  noGrants=false;

  staleMfa=true;
  const stale=await get(token);
  assert.equal(stale.status,401);
  assert.equal(caseQueries,2);
  staleMfa=false;

  revoked=true;
  const denied=await get(token);
  assert.equal(denied.status,401);
  const body=await denied.text();
  assert.equal(caseQueries,2);
  assert.ok(!body.includes(token));
  assert.ok(!body.includes(deniedScope));
 }finally{
  if(app)await app.close();
  if(oldFlag===undefined)delete process.env.SERVICES_ENABLE_PLATFORM_MODERATION_HTTP;
  else process.env.SERVICES_ENABLE_PLATFORM_MODERATION_HTTP=oldFlag;
  if(oldKey===undefined)delete process.env.PLATFORM_ADMIN_SESSION_HMAC_KEY;
  else process.env.PLATFORM_ADMIN_SESSION_HMAC_KEY=oldKey;
 }
});
