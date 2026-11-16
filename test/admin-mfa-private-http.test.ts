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
 const previous={
  enabled:process.env.SERVICES_ENABLE_ADMIN_MFA_PRIVATE_HTTP,
  key:process.env.ADMIN_MFA_BFF_KEY,
  account:process.env.ACCOUNT_LOGIN_BFF_KEY,
  admin:process.env.PLATFORM_ADMIN_SESSION_HMAC_KEY,
  session:process.env.ACCOUNT_SESSION_HMAC_KEY,
 };
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
  // Even when explicitly enabled in this isolated test module, callers
  // without the trusted BFF credential must never reach PostgreSQL.
  process.env.SERVICES_ENABLE_ADMIN_MFA_PRIVATE_HTTP='enabled';
  process.env.ADMIN_MFA_BFF_KEY=randomBytes(32).toString('base64');
  delete process.env.ACCOUNT_LOGIN_BFF_KEY;
  delete process.env.PLATFORM_ADMIN_SESSION_HMAC_KEY;
  delete process.env.ACCOUNT_SESSION_HMAC_KEY;
  const denied=await fetch(`http://127.0.0.1:${address.port}/v1/admin/private/mfa/verify`,{
   method:'POST',
   headers:{'content-type':'application/json'},
   body:JSON.stringify({account_session_token:randomBytes(32).toString('base64url'),totp_code:'123456'}),
  });
  assert.equal(denied.status,404);
  assert.equal(connects,0);
  assert.match(denied.headers.get('cache-control')??'',/no-store/);
  const wrongKey=await fetch(`http://127.0.0.1:${address.port}/v1/admin/private/mfa/verify`,{
   method:'POST',
   headers:{
    'content-type':'application/json',
    'x-services-admin-mfa-key':randomBytes(32).toString('base64'),
   },
   body:JSON.stringify({account_session_token:randomBytes(32).toString('base64url'),totp_code:'123456'}),
  });
  assert.equal(wrongKey.status,404);
  assert.equal(connects,0);
  const malformed=await fetch(`http://127.0.0.1:${address.port}/v1/admin/private/mfa/verify`,{
   method:'POST',
   headers:{
    'content-type':'application/json',
    'x-services-admin-mfa-key':process.env.ADMIN_MFA_BFF_KEY!,
   },
   body:JSON.stringify({
    account_session_token:randomBytes(32).toString('base64url'),
    totp_code:'123456',
    staffId:'caller-controlled',
   }),
  });
  assert.equal(malformed.status,401);
  assert.equal(connects,0);
 }finally{
  await app.close();
  for(const [name,value] of Object.entries({
   SERVICES_ENABLE_ADMIN_MFA_PRIVATE_HTTP:previous.enabled,
   ADMIN_MFA_BFF_KEY:previous.key,
   ACCOUNT_LOGIN_BFF_KEY:previous.account,
   PLATFORM_ADMIN_SESSION_HMAC_KEY:previous.admin,
   ACCOUNT_SESSION_HMAC_KEY:previous.session,
  })){
   if(value===undefined)delete process.env[name];
   else process.env[name]=value;
  }
 }
});
