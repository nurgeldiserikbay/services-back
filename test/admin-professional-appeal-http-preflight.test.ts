import 'reflect-metadata';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomBytes,randomUUID} from 'node:crypto';
import {Module,UnauthorizedException} from '@nestjs/common';
import {NestFactory} from '@nestjs/core';
import {DatabasePool} from '../src/platform/database/database.pool.js';
import {PlatformProfessionalAppealAdminController} from '../src/modules/admin/admin-professional-appeal-http.controller.js';
import {PlatformProfessionalAppealAdminService} from '../src/modules/admin/admin-professional-appeal-http.service.js';
import {PlatformAppealHttpErrorFilter} from '../src/modules/admin/admin-professional-appeal-http-error.filter.js';
import {privateAppealCharsetPreflight} from '../src/modules/admin/admin-professional-appeal-http-charset.middleware.js';
import {privateAppealParserErrorMiddleware} from '../src/modules/admin/admin-professional-appeal-http-parser-error.middleware.js';

test('unregistered private appeal transport denies default-off, browser origin and invalid admin proof before DB',async()=>{
 const assignFlag='SERVICES_ENABLE_PLATFORM_APPEAL_ASSIGN_HTTP';
 const decideFlag='SERVICES_ENABLE_PLATFORM_APPEAL_DECIDE_HTTP';
 const oldAssign=process.env[assignFlag],oldDecide=process.env[decideFlag];
 const oldKey=process.env.PLATFORM_ADMIN_SESSION_HMAC_KEY;
 const pepper=randomBytes(32),appeal=randomUUID(),profile=randomUUID(),reviewer=randomUUID();
 let dbCalls=0;
 @Module({controllers:[PlatformProfessionalAppealAdminController],providers:[
  PlatformProfessionalAppealAdminService,
  {provide:DatabasePool,useValue:{transaction:async()=>{dbCalls++;throw Error('DB must not be called');}}},
 ]})
 class IsolatedTestModule{}
 let app:Awaited<ReturnType<typeof NestFactory.create>>|undefined;
 process.env.PLATFORM_ADMIN_SESSION_HMAC_KEY=pepper.toString('base64');
 try{
  app=await NestFactory.create(IsolatedTestModule,{logger:false});
  // Future private transport would register this filter at the Nest HTTP boundary.
  // Express pre-parser middleware must be registered before app.listen/init.
  app.use(privateAppealCharsetPreflight);
  app.useGlobalFilters(new PlatformAppealHttpErrorFilter());
  app.setGlobalPrefix('v1');
  await app.init(); // Register Nest/body-parser routes first.
  app.use(privateAppealParserErrorMiddleware); // Express four-argument error handler.
  await app.listen(0,'127.0.0.1');
  const base=(await app.getUrl())+'/v1/admin/moderation/appeals/'+appeal;
  const validShape=():string=>'Bearer '+randomBytes(32).toString('base64url');
  const request=(route:'assignment'|'decision',headers:Record<string,string>={})=>fetch(base+'/'+route,{
   method:'POST',headers:{
    'Content-Type':'application/json',Authorization:validShape(),...headers,
   },
   body:JSON.stringify(route==='assignment'
    ?{profile_id:profile,profile_version:1,reviewer_staff_id:reviewer}
    :{profile_id:profile,profile_version:1,outcome:'UPHOLD_REJECTION'}),
   redirect:'manual',
  });
  process.env[assignFlag]='disabled';process.env[decideFlag]='disabled';
  for(const route of ['assignment','decision'] as const){
   assert.equal((await request(route)).status,401,'default-off');
  }
  process.env[assignFlag]='enabled';process.env[decideFlag]='enabled';
  for(const route of ['assignment','decision'] as const){
   assert.equal((await request(route,{Origin:'https://evil.example'})).status,401);
   assert.equal((await request(route,{'Sec-Fetch-Site':'cross-site'})).status,401);
   assert.equal((await request(route,{'Sec-Fetch-Site':'same-origin'})).status,401);
   assert.equal((await request(route,{'Content-Type':'text/plain'})).status,401);
   const unsupported=await request(route,{'Content-Type':'application/json; charset=iso-8859-1'});
   assert.equal(unsupported.status,415,'unsupported charset must normalize to HTTP 415');
   assert.deepEqual(await unsupported.json(),{statusCode:415,message:'Unsupported Media Type'});
   assert.match(unsupported.headers.get('cache-control')??'',/no-store/);
   assert.equal(unsupported.headers.get('x-content-type-options'),'nosniff');
   const malformed=await fetch(base+'/'+route,{
    method:'POST',
    headers:{'Content-Type':'application/json',Authorization:validShape()},
    body:'{"broken":',redirect:'manual',
   });
   assert.equal(malformed.status,400,'invalid JSON must not reach controller or DB');
   assert.deepEqual(await malformed.json(),{statusCode:400,message:'Bad Request'});
   assert.equal((await request(route,{Authorization:'Basic invalid'})).status,401);
   const bad=await request(route,{Authorization:'Bearer invalid'});
   assert.equal(bad.status,401);
   assert.match(bad.headers.get('cache-control')??'',/no-store/);
   assert.equal(bad.headers.get('x-content-type-options'),'nosniff');
  }
  const controller=app.get(PlatformProfessionalAppealAdminController);
  assert.throws(()=>controller.assign('Bearer invalid',undefined,'none',
   'application/json; charset=iso-8859-1',appeal,{}),UnauthorizedException);
  assert.throws(()=>controller.decide('Bearer invalid',undefined,'none',
   'application/json; charset=iso-8859-1',appeal,{}),UnauthorizedException);
  assert.equal(dbCalls,0,'preflight and proof errors must never reach DB');
 }finally{
  await app?.close();
  if(oldAssign===undefined)delete process.env[assignFlag];else process.env[assignFlag]=oldAssign;
  if(oldDecide===undefined)delete process.env[decideFlag];else process.env[decideFlag]=oldDecide;
  if(oldKey===undefined)delete process.env.PLATFORM_ADMIN_SESSION_HMAC_KEY;
  else process.env.PLATFORM_ADMIN_SESSION_HMAC_KEY=oldKey;
 }
});
