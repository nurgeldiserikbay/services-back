import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {exchangePrivateAdminMfa} from '../src/modules/admin/admin-mfa-private-exchange.js';

test('private MFA exchange rejects transport and malformed requests without DB access',async()=>{
 const previous={
  enabled:process.env.SERVICES_ENABLE_ADMIN_MFA_PRIVATE_HTTP,
  key:process.env.ADMIN_MFA_BFF_KEY,
  account:process.env.ACCOUNT_LOGIN_BFF_KEY,
  admin:process.env.PLATFORM_ADMIN_SESSION_HMAC_KEY,
  session:process.env.ACCOUNT_SESSION_HMAC_KEY,
 };
 let connections=0,keyReads=0;
 const key=randomBytes(32).toString('base64');
 const deps={
  pool:{connect:async()=>{connections++;throw new Error('unexpected database access');}},
  accountSessionPepper:randomBytes(32),
  adminSessionPepper:randomBytes(32),
  resolveTotpKey:async()=>{keyReads++;return null;},
 };
 try{
  process.env.SERVICES_ENABLE_ADMIN_MFA_PRIVATE_HTTP='enabled';
  process.env.ADMIN_MFA_BFF_KEY=key;
  delete process.env.ACCOUNT_LOGIN_BFF_KEY;
  delete process.env.PLATFORM_ADMIN_SESSION_HMAC_KEY;
  delete process.env.ACCOUNT_SESSION_HMAC_KEY;
  await assert.rejects(exchangePrivateAdminMfa('wrong',{
   account_session_token:randomBytes(32).toString('base64url'),
   totp_code:'123456',
  },deps));
  assert.equal(await exchangePrivateAdminMfa(key,{
   account_session_token:randomBytes(32).toString('base64url'),
   totp_code:'123456',staffId:'untrusted',
  },deps),null);
  assert.equal(await exchangePrivateAdminMfa(key,{
   account_session_token:'invalid',totp_code:'123456',
  },deps),null);
  assert.equal(connections,0);
  assert.equal(keyReads,0);
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
