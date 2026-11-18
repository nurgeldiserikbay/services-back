import 'reflect-metadata';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {Module} from '@nestjs/common';
import {NestFactory} from '@nestjs/core';
import {DatabasePool} from '../src/platform/database/database.pool.js';
import {PlatformProfessionalDecisionController} from '../src/modules/admin/admin-professional-decision.controller.js';
import {PlatformProfessionalDecisionService} from '../src/modules/admin/admin-professional-decision.service.js';
import {randomBytes,randomUUID} from 'node:crypto';

test('moderation decision HTTP denies default-off, browser origin and invalid admin bearer before DB',async()=>{
 const oldFlag=process.env.SERVICES_ENABLE_PLATFORM_MODERATION_DECIDE_HTTP;
 const oldKey=process.env.PLATFORM_ADMIN_SESSION_HMAC_KEY;
 const pepper=randomBytes(32);
 const profile=randomUUID(),caseId=randomUUID();
 let dbCalls=0;
 @Module({controllers:[PlatformProfessionalDecisionController],providers:[
  PlatformProfessionalDecisionService,
  {provide:DatabasePool,useValue:{transaction:async()=>{dbCalls++;throw Error('DB should not be touched');}}},
 ]})
 class TestModule{}
 let app:Awaited<ReturnType<typeof NestFactory.create>>|undefined;
 process.env.PLATFORM_ADMIN_SESSION_HMAC_KEY=pepper.toString('base64');
 try{
  app=await NestFactory.create(TestModule,{logger:false});
  app.setGlobalPrefix('v1');
  await app.listen(0,'127.0.0.1');
  const url=(await app.getUrl())+'/v1/admin/moderation/cases/'+caseId+'/decision';
  const request=(headers:Record<string,string>)=>fetch(url,{method:'POST',headers:{
   'Content-Type':'application/json',Authorization:'Bearer '+randomBytes(32).toString('base64url'),...headers,
  },body:JSON.stringify({profile_id:profile,profile_version:1,decision:'APPROVE'}),redirect:'manual'});
  process.env.SERVICES_ENABLE_PLATFORM_MODERATION_DECIDE_HTTP='disabled';
  assert.equal((await request({})).status,401);
  process.env.SERVICES_ENABLE_PLATFORM_MODERATION_DECIDE_HTTP='enabled';
  assert.equal((await request({Origin:'https://evil.example'})).status,401);
  assert.equal((await request({'Sec-Fetch-Site':'cross-site'})).status,401);
  assert.equal((await request({'Content-Type':'text/plain'})).status,401);
  assert.equal((await request({Authorization:'Basic invalid'})).status,401);
  const invalid=await request({Authorization:'Bearer invalid'});
  assert.equal(invalid.status,401);
  assert.match(invalid.headers.get('cache-control')??'',/no-store/);
  assert.equal(dbCalls,0);
 }finally{
  await app?.close();
  if(oldFlag===undefined)delete process.env.SERVICES_ENABLE_PLATFORM_MODERATION_DECIDE_HTTP;
  else process.env.SERVICES_ENABLE_PLATFORM_MODERATION_DECIDE_HTTP=oldFlag;
  if(oldKey===undefined)delete process.env.PLATFORM_ADMIN_SESSION_HMAC_KEY;
  else process.env.PLATFORM_ADMIN_SESSION_HMAC_KEY=oldKey;
 }
});
