import 'reflect-metadata';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {NestFactory} from '@nestjs/core';
import {Module} from '@nestjs/common';
import {DatabasePool} from '../src/platform/database/database.pool.js';
import {PlatformAdminLogoutController} from '../src/modules/admin/admin-logout.controller.js';
import {PlatformAdminLogoutService} from '../src/modules/admin/admin-logout.service.js';
import {issueAdminSessionToken,hashAdminSessionToken} from '../src/modules/admin/admin-session-token.js';

test('admin logout HTTP validates bearer and revokes the matching session in a transaction',async()=>{
 const previousFlag=process.env.SERVICES_ENABLE_PLATFORM_ADMIN_LOGOUT_HTTP;
 const previousKey=process.env.PLATFORM_ADMIN_SESSION_HMAC_KEY;
 const pepper=randomBytes(32);
 const {token}=issueAdminSessionToken(pepper);
 const statements:{sql:string;params:unknown[]}[]=[];
 let transactions=0;
 let failQuery=false;
 const database={
  transaction:async<T>(work:(client:{query:(sql:string,params:unknown[])=>Promise<unknown>})=>Promise<T>):Promise<T>=>{
   transactions++;
   return work({query:async(sql:string,params:unknown[])=>{
    statements.push({sql,params});
    if(failQuery)throw new Error('private database credentials must not leak');
    return {rows:statements.length===1?[{id:randomUUID()}]:[]};
   }});
  },
 };
 @Module({
  controllers:[PlatformAdminLogoutController],
  providers:[PlatformAdminLogoutService,{provide:DatabasePool,useValue:database}],
 })
 class TestModule{}
 process.env.SERVICES_ENABLE_PLATFORM_ADMIN_LOGOUT_HTTP='enabled';
 process.env.PLATFORM_ADMIN_SESSION_HMAC_KEY=pepper.toString('base64');
 let app:Awaited<ReturnType<typeof NestFactory.create>>|undefined;
 try{
  app=await NestFactory.create(TestModule,{logger:false});
  app.setGlobalPrefix('v1');
  await app.listen(0,'127.0.0.1');
  const address=app.getHttpServer().address();
  assert.ok(address&&typeof address!=='string');
  const url=`http://127.0.0.1:${address.port}/v1/admin/session/logout`;
  const denied=await fetch(url,{method:'POST'});
  assert.equal(denied.status,401);
  assert.match(denied.headers.get('cache-control')??'',/no-store/);
  assert.equal(denied.headers.get('x-robots-tag'),'noindex, nofollow');
  assert.equal(transactions,0);
  for(const authorization of ['Basic abc','Bearer invalid',`Bearer ${token}, Bearer ${token}`]){
   const rejected=await fetch(url,{method:'POST',headers:{authorization}});
   assert.equal(rejected.status,401);
   assert.equal(transactions,0);
  }
  process.env.SERVICES_ENABLE_PLATFORM_ADMIN_LOGOUT_HTTP='disabled';
  const disabled=await fetch(url,{method:'POST',headers:{authorization:`Bearer ${token}`}});
  assert.equal(disabled.status,401);
  assert.equal(transactions,0);
  process.env.SERVICES_ENABLE_PLATFORM_ADMIN_LOGOUT_HTTP='enabled';
  process.env.PLATFORM_ADMIN_SESSION_HMAC_KEY='invalid';
  const invalidSecret=await fetch(url,{method:'POST',headers:{authorization:`Bearer ${token}`}});
  assert.equal(invalidSecret.status,401);
  assert.equal(transactions,0);
  delete process.env.PLATFORM_ADMIN_SESSION_HMAC_KEY;
  const missingSecret=await fetch(url,{method:'POST',headers:{authorization:`Bearer ${token}`}});
  assert.equal(missingSecret.status,401);
  assert.equal(transactions,0);
  process.env.PLATFORM_ADMIN_SESSION_HMAC_KEY=pepper.toString('base64');
  const allowed=await fetch(url,{method:'POST',headers:{authorization:`Bearer ${token}`}});
  assert.equal(allowed.status,200);
  assert.deepEqual(await allowed.json(),{status:'revoked'});
  assert.equal(transactions,1);
  assert.equal(statements.length,1);
  assert.match(statements[0]!.sql,/UPDATE platform_admin_sessions/);
  assert.equal(statements[0]!.params[0],hashAdminSessionToken(token,pepper));
  assert.notEqual(statements[0]!.params[0],token);
  const repeated=await fetch(url,{method:'POST',headers:{authorization:`Bearer ${token}`}});
  assert.equal(repeated.status,200);
  assert.deepEqual(await repeated.json(),{status:'revoked'});
  assert.equal(transactions,2);
  assert.equal(statements.length,2);
  assert.equal(statements[1]!.params[0],statements[0]!.params[0]);
  assert.equal(statements[1]!.params.length,2);
  assert.match(statements[1]!.sql,/revoked_at IS NULL/);
  failQuery=true;
  const unavailable=await fetch(url,{method:'POST',headers:{authorization:`Bearer ${token}`}});
  assert.equal(unavailable.status,401);
  const errorBody=await unavailable.text();
  assert.doesNotMatch(errorBody,/private database credentials|token_hash|platform_admin_sessions/i);
  assert.match(unavailable.headers.get('cache-control')??'',/no-store/);
  assert.equal(transactions,3);
 }finally{
  await app?.close();
  if(previousFlag===undefined)delete process.env.SERVICES_ENABLE_PLATFORM_ADMIN_LOGOUT_HTTP;
  else process.env.SERVICES_ENABLE_PLATFORM_ADMIN_LOGOUT_HTTP=previousFlag;
  if(previousKey===undefined)delete process.env.PLATFORM_ADMIN_SESSION_HMAC_KEY;
  else process.env.PLATFORM_ADMIN_SESSION_HMAC_KEY=previousKey;
 }
});
