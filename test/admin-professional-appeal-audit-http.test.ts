import 'reflect-metadata';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomBytes,randomUUID} from 'node:crypto';
import {Module} from '@nestjs/common';
import {NestFactory} from '@nestjs/core';
import {DatabasePool} from '../src/platform/database/database.pool.js';
import {PlatformProfessionalAppealAuditReadController} from '../src/modules/admin/admin-professional-appeal-audit-http.controller.js';
import {PlatformProfessionalAppealAuditReadService} from '../src/modules/admin/admin-professional-appeal-audit-http.service.js';

test('isolated appeal audit GET is default-off and rejects browser credentials before database',async()=>{
 const flag='SERVICES_ENABLE_PLATFORM_APPEAL_AUDIT_READ_HTTP';
 const originalFlag=process.env[flag],originalKey=process.env.PLATFORM_ADMIN_SESSION_HMAC_KEY;
 const appeal=randomUUID(),profile=randomUUID();
 let dbCalls=0;
 @Module({controllers:[PlatformProfessionalAppealAuditReadController],providers:[
  PlatformProfessionalAppealAuditReadService,
  {provide:DatabasePool,useValue:{transaction:async()=>{
   dbCalls++;throw Error('DB must not be touched by denied request');
  }}},
 ]})class IsolatedModule{}
 let app:Awaited<ReturnType<typeof NestFactory.create>>|undefined;
 process.env.PLATFORM_ADMIN_SESSION_HMAC_KEY=randomBytes(32).toString('base64');
 try{
  app=await NestFactory.create(IsolatedModule,{logger:false});
  app.setGlobalPrefix('v1');await app.listen(0,'127.0.0.1');
  const url=(await app.getUrl())+'/v1/admin/moderation/appeals/'+appeal+'/audit?profile_id='+profile;
  const bearer='Bearer '+randomBytes(32).toString('base64url');
  const read=(headers:Record<string,string>={})=>fetch(url,{
   method:'GET',headers:{Authorization:bearer,...headers},redirect:'manual',
  });
  process.env[flag]='disabled';
  assert.equal((await read()).status,401);
  process.env[flag]='enabled';
  for(const headers of [
   {Origin:'https://evil.example'},
   {Origin:'null'},
   {'Sec-Fetch-Site':'cross-site'},
   {'Sec-Fetch-Site':'none'},
   {'Sec-Fetch-Dest':'document'},
   {'Sec-Fetch-User':'?1'},
   {Referer:'https://admin.example/dashboard'},
   {Cookie:'session=forged'},
   {Authorization:'Basic bad'},
   {Authorization:'Bearer invalid'},
  ] as Record<string,string>[]){
   const denied=await read(headers);
   assert.equal(denied.status,401);
   assert.match(denied.headers.get('cache-control')??'',/no-store/);
   assert.equal(denied.headers.get('x-content-type-options'),'nosniff');
   assert.equal(denied.headers.get('x-robots-tag'),'noindex, nofollow');
  }
  assert.equal(dbCalls,0,'no denied browser or bearer may invoke a DB transaction');
 }finally{
  await app?.close();
  if(originalFlag===undefined)delete process.env[flag];else process.env[flag]=originalFlag;
  if(originalKey===undefined)delete process.env.PLATFORM_ADMIN_SESSION_HMAC_KEY;
  else process.env.PLATFORM_ADMIN_SESSION_HMAC_KEY=originalKey;
 }
});
