import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {PrivateAdminMfaController} from '../src/modules/admin/admin-mfa-private.controller.js';

test('private MFA controller remains unregistered and uses trusted dependency injection',()=>{
 const controller=readFileSync('src/modules/admin/admin-mfa-private.controller.ts','utf8');
 const module=readFileSync('src/modules/admin/admin-moderation.module.ts','utf8');
 assert.match(controller,/exchangePrivateAdminMfa\(access,body,this\.dependencies\)/);
 assert.match(controller,/@Inject\(PRIVATE_ADMIN_MFA_DEPS\)/);
 assert.match(controller,/Cache-Control','private, no-store/);
 assert.doesNotMatch(module,/PrivateAdminMfaController/);
});

test('private MFA controller denies requests before accessing the database',async()=>{
 const prior={
  enabled:process.env.SERVICES_ENABLE_ADMIN_MFA_PRIVATE_HTTP,
  key:process.env.ADMIN_MFA_BFF_KEY,
  account:process.env.ACCOUNT_LOGIN_BFF_KEY,
  admin:process.env.PLATFORM_ADMIN_SESSION_HMAC_KEY,
  session:process.env.ACCOUNT_SESSION_HMAC_KEY,
 };
 let connections=0;
 const credential=randomBytes(32).toString('base64');
 const controller=new PrivateAdminMfaController({
  pool:{connect:async()=>{connections++;throw Error('database unavailable');}} as never,
  accountSessionPepper:randomBytes(32),
  adminSessionPepper:randomBytes(32),
  resolveTotpKey:async()=>null,
 });
 try{
  delete process.env.SERVICES_ENABLE_ADMIN_MFA_PRIVATE_HTTP;
  process.env.ADMIN_MFA_BFF_KEY=credential;
  await assert.rejects(controller.verify(credential,{}),{name:'NotFoundException'});
  process.env.SERVICES_ENABLE_ADMIN_MFA_PRIVATE_HTTP='enabled';
  delete process.env.ACCOUNT_LOGIN_BFF_KEY;
  delete process.env.PLATFORM_ADMIN_SESSION_HMAC_KEY;
  delete process.env.ACCOUNT_SESSION_HMAC_KEY;
  await assert.rejects(controller.verify(credential,{}),{name:'UnauthorizedException'});
  assert.equal(connections,0);
 }finally{
  for(const [name,value] of Object.entries({
   SERVICES_ENABLE_ADMIN_MFA_PRIVATE_HTTP:prior.enabled,
   ADMIN_MFA_BFF_KEY:prior.key,
   ACCOUNT_LOGIN_BFF_KEY:prior.account,
   PLATFORM_ADMIN_SESSION_HMAC_KEY:prior.admin,
   ACCOUNT_SESSION_HMAC_KEY:prior.session,
  })){
   if(value===undefined)delete process.env[name];
   else process.env[name]=value;
  }
 }
});

test('private MFA controller sanitizes database failures and preserves genuine hidden route',async()=>{
 const previous={
  enabled:process.env.SERVICES_ENABLE_ADMIN_MFA_PRIVATE_HTTP,
  key:process.env.ADMIN_MFA_BFF_KEY,
  account:process.env.ACCOUNT_LOGIN_BFF_KEY,
  admin:process.env.PLATFORM_ADMIN_SESSION_HMAC_KEY,
  session:process.env.ACCOUNT_SESSION_HMAC_KEY,
 };
 const credential=randomBytes(32).toString('base64');
 const token=randomBytes(32).toString('base64url');
 let connections=0;
 const controller=new PrivateAdminMfaController({
  pool:{connect:async()=>{connections++;throw Error('private database password');}} as never,
  accountSessionPepper:randomBytes(32),
  adminSessionPepper:randomBytes(32),
  resolveTotpKey:async()=>null,
 });
 try{
  process.env.ADMIN_MFA_BFF_KEY=credential;
  delete process.env.ACCOUNT_LOGIN_BFF_KEY;
  delete process.env.PLATFORM_ADMIN_SESSION_HMAC_KEY;
  delete process.env.ACCOUNT_SESSION_HMAC_KEY;
  delete process.env.SERVICES_ENABLE_ADMIN_MFA_PRIVATE_HTTP;
  await assert.rejects(controller.verify(credential,{
   account_session_token:token,totp_code:'123456',
  }),{name:'NotFoundException'});
  assert.equal(connections,0);
  process.env.SERVICES_ENABLE_ADMIN_MFA_PRIVATE_HTTP='enabled';
  await assert.rejects(controller.verify(credential,{
   account_session_token:token,totp_code:'123456',
  }),error=>{
   assert.equal((error as Error).name,'ServiceUnavailableException');
   assert.doesNotMatch((error as Error).message,/private database password/);
   return true;
  });
  assert.equal(connections,1);
 }finally{
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
