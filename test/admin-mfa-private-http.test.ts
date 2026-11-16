import 'reflect-metadata';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {Module} from '@nestjs/common';
import {NestFactory} from '@nestjs/core';
import {
 PrivateAdminMfaController,PRIVATE_ADMIN_MFA_DEPS,
} from '../src/modules/admin/admin-mfa-private.controller.js';

test('isolated Nest HTTP boundary keeps private MFA hidden without deployment opt-in',async()=>{
 let connects=0;
 @Module({
  controllers:[PrivateAdminMfaController],
  providers:[{provide:PRIVATE_ADMIN_MFA_DEPS,useValue:{
   pool:{connect:async()=>{connects++;throw Error('database should not be called');}},
   accountSessionPepper:randomBytes(32),
   adminSessionPepper:randomBytes(32),
   resolveTotpKey:async()=>null,
  }}],
 })
 class IsolatedMfaTestModule{}
 const original=process.env.SERVICES_ENABLE_ADMIN_MFA_PRIVATE_HTTP;
 const app=await NestFactory.create(IsolatedMfaTestModule,{logger:false});
 try{
  app.setGlobalPrefix('v1');
  delete process.env.SERVICES_ENABLE_ADMIN_MFA_PRIVATE_HTTP;
  await app.listen(0,'127.0.0.1');
  const address=app.getHttpServer().address();
  assert.ok(address&&typeof address!=='string');
  const response=await fetch(`http://127.0.0.1:${address.port}/v1/admin/private/mfa/verify`,{
   method:'POST',
   headers:{'content-type':'application/json','x-services-admin-mfa-key':randomBytes(32).toString('base64')},
   body:JSON.stringify({account_session_token:randomBytes(32).toString('base64url'),totp_code:'123456'}),
  });
  assert.equal(response.status,404);
  assert.equal(connects,0);
  assert.match(response.headers.get('cache-control')??'',/no-store/);
 }finally{
  await app.close();
  if(original===undefined)delete process.env.SERVICES_ENABLE_ADMIN_MFA_PRIVATE_HTTP;
  else process.env.SERVICES_ENABLE_ADMIN_MFA_PRIVATE_HTTP=original;
 }
});
