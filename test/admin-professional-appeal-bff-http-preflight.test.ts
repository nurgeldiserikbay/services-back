import 'reflect-metadata';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomBytes,randomUUID} from 'node:crypto';
import {Module} from '@nestjs/common';
import {NestFactory} from '@nestjs/core';
import {
 APPEAL_BFF_HTTP_BOUNDARY,PlatformProfessionalAppealBffController,
 type AppealBffHttpBoundary,
} from '../src/modules/admin/admin-professional-appeal-bff-http.controller.js';

test('isolated Nest BFF HTTP boundary denies default-off and malformed browser input before privileged dependencies',async()=>{
 const flag='SERVICES_ENABLE_PLATFORM_APPEAL_BFF_HTTP',old=process.env[flag];
 const origin='https://admin.example.kz',appealId=randomUUID();
 const cookie='__Host-services-appeal-session='+randomBytes(32).toString('base64url');
 const csrf='v1.'+Date.now()+'.'+'A'.repeat(22)+'.'+'B'.repeat(43);
 let issued=0,mutated=0;
 const boundary:AppealBffHttpBoundary={
  expectedOrigin:origin,
  issueCsrf:async context=>{
   issued++;assert.equal(context.appealId,appealId);
   assert.equal(context.expectedOrigin,origin);
   assert.ok(context.rawCookieHeader.includes(cookie));
   return {token:'isolated-test-only'};
  },
  mutate:async context=>{
   mutated++;assert.equal(context.csrfToken,csrf);
   assert.equal(context.action,'decision');
   return {ok:true};
  },
 };
 @Module({controllers:[PlatformProfessionalAppealBffController],
  providers:[{provide:APPEAL_BFF_HTTP_BOUNDARY,useValue:boundary}]})
 class IsolatedBffTestModule{}
 const app=await NestFactory.create(IsolatedBffTestModule,{logger:false});
 try{
  app.setGlobalPrefix('v1');
  await app.listen(0,'127.0.0.1');
  const base=(await app.getUrl())+'/v1/admin/bff/moderation/appeals/'+appealId;
  const headers={Origin:origin,'Sec-Fetch-Site':'same-origin',Cookie:cookie,
   'Content-Type':'application/json'};
  const post=(path:string,h:Record<string,string>={},body='{}')=>
   fetch(base+path,{method:'POST',headers:{...headers,...h},body,redirect:'manual'});
  process.env[flag]='disabled';
  let response=await post('/decision/csrf');
  assert.equal(response.status,401);
  assert.equal(issued,0);assert.equal(mutated,0);
  process.env[flag]='enabled';
  const deniedHeaders:Record<string,string>[]=[
   {Origin:'https://evil.example'},
   {'Sec-Fetch-Site':'cross-site'},
   {Cookie:'session=unknown'},
   {Cookie:cookie+'; '+cookie},
   {Authorization:'Bearer '+randomBytes(32).toString('base64url')},
   {'Content-Type':'text/plain'},
  ];
  for(const h of deniedHeaders){
   response=await post('/decision/csrf',h);
   assert.equal(response.status,401,JSON.stringify(h));
  }
  assert.equal(issued,0);assert.equal(mutated,0);
  response=await post('/decision/csrf');
  assert.equal(response.status,200);
  assert.deepEqual(await response.json(),{token:'isolated-test-only'});
  assert.match(response.headers.get('cache-control')??'',/no-store/);
  assert.equal(response.headers.get('x-content-type-options'),'nosniff');
  assert.equal(response.headers.get('referrer-policy'),'no-referrer');
  response=await post('/decision',{'x-appeal-csrf':'invalid'});
  assert.equal(response.status,401);
  response=await post('/decision',{'x-appeal-csrf':csrf});
  assert.equal(response.status,200);
  assert.deepEqual(await response.json(),{ok:true});
  assert.equal(issued,1);assert.equal(mutated,1);
  for(const path of ['/unknown/csrf','/unknown']){
   response=await post(path,{'x-appeal-csrf':csrf});
   assert.equal(response.status,401);
  }
  assert.equal(mutated,1);
 }finally{
  await app.close();
  if(old===undefined)delete process.env[flag];else process.env[flag]=old;
 }
});

test('BFF controller direct preflight rejects missing, duplicated or forged raw headers before adapters',async()=>{
 const {UnauthorizedException}=await import('@nestjs/common');
 const origin='https://admin.example.kz',id=randomUUID();
 const cookie='__Host-services-appeal-session='+randomBytes(32).toString('base64url');
 const old=process.env.SERVICES_ENABLE_PLATFORM_APPEAL_BFF_HTTP;
 process.env.SERVICES_ENABLE_PLATFORM_APPEAL_BFF_HTTP='enabled';
 let calls=0;
 const controller=new PlatformProfessionalAppealBffController({
  expectedOrigin:origin,
  issueCsrf:async()=>{calls++;return {token:'test'};},
  mutate:async()=>{calls++;return {ok:true};},
 });
 const headers=['Origin',origin,'Cookie',cookie,'Sec-Fetch-Site','same-origin',
  'Content-Type','application/json'];
 try{
  for(const rawHeaders of [
   [],['Origin',origin,'Origin',origin,...headers.slice(2)],
   [...headers,'Authorization','Bearer invalid'],
   [...headers,'Cookie',cookie],['Origin','null',...headers.slice(2)],
   [...headers.slice(0,-2)],
  ]){
   assert.throws(()=>controller.issue({method:'POST',rawHeaders},id,'decision',{}),
    UnauthorizedException);
  }
  assert.throws(()=>controller.issue({method:'GET',rawHeaders:headers},id,'decision',{}),
   UnauthorizedException);
  assert.equal(calls,0);
 }finally{
  if(old===undefined)delete process.env.SERVICES_ENABLE_PLATFORM_APPEAL_BFF_HTTP;
  else process.env.SERVICES_ENABLE_PLATFORM_APPEAL_BFF_HTTP=old;
 }
});
