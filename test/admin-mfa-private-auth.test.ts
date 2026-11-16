import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {requirePrivateAdminMfaAccess} from '../src/modules/admin/admin-mfa-private-auth.js';

test('private admin MFA transport is disabled by default and rejects missing credentials',()=>{
 const original={
  enabled:process.env.SERVICES_ENABLE_ADMIN_MFA_PRIVATE_HTTP,
  key:process.env.ADMIN_MFA_BFF_KEY,
  account:process.env.ACCOUNT_LOGIN_BFF_KEY,
  admin:process.env.PLATFORM_ADMIN_SESSION_HMAC_KEY,
  session:process.env.ACCOUNT_SESSION_HMAC_KEY,
 };
 try{
  const key=randomBytes(32).toString('base64');
  delete process.env.SERVICES_ENABLE_ADMIN_MFA_PRIVATE_HTTP;
  process.env.ADMIN_MFA_BFF_KEY=key;
  assert.throws(()=>requirePrivateAdminMfaAccess(key));
  process.env.SERVICES_ENABLE_ADMIN_MFA_PRIVATE_HTTP='enabled';
  assert.throws(()=>requirePrivateAdminMfaAccess(null));
  assert.throws(()=>requirePrivateAdminMfaAccess('wrong'));
  assert.throws(()=>requirePrivateAdminMfaAccess(randomBytes(32).toString('base64')));
  delete process.env.ACCOUNT_LOGIN_BFF_KEY;
  delete process.env.PLATFORM_ADMIN_SESSION_HMAC_KEY;
  delete process.env.ACCOUNT_SESSION_HMAC_KEY;
  assert.doesNotThrow(()=>requirePrivateAdminMfaAccess(key));
  process.env.ACCOUNT_LOGIN_BFF_KEY=key;
  assert.throws(()=>requirePrivateAdminMfaAccess(key));
  delete process.env.ACCOUNT_LOGIN_BFF_KEY;
  process.env.PLATFORM_ADMIN_SESSION_HMAC_KEY=key;
  assert.throws(()=>requirePrivateAdminMfaAccess(key));
 }finally{
  for(const [name,value] of Object.entries({
   SERVICES_ENABLE_ADMIN_MFA_PRIVATE_HTTP:original.enabled,
   ADMIN_MFA_BFF_KEY:original.key,
   ACCOUNT_LOGIN_BFF_KEY:original.account,
   PLATFORM_ADMIN_SESSION_HMAC_KEY:original.admin,
   ACCOUNT_SESSION_HMAC_KEY:original.session,
  })){
   if(value===undefined)delete process.env[name];
   else process.env[name]=value;
  }
 }
});
