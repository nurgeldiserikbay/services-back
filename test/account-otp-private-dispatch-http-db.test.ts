import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHmac,randomBytes,randomUUID} from 'node:crypto';
import {Client} from 'pg';
import {Module,NotFoundException,ServiceUnavailableException} from '@nestjs/common';
import {NestFactory} from '@nestjs/core';
import {AccountOtpDispatchPrivateController}
 from '../src/modules/identity/account-otp-dispatch-private.controller.js';
import {AccountOtpDispatchService}
 from '../src/modules/identity/account-otp-dispatch.service.js';

const envKeys=[
 'SERVICES_ENABLE_ACCOUNT_LOGIN_HTTP',
 'SERVICES_ENABLE_ACCOUNT_OTP_DISPATCH_HTTP',
 'ACCOUNT_LOGIN_BFF_KEY','ACCOUNT_NETWORK_ATTESTATION_KEY',
 'ACCOUNT_OTP_HMAC_KEY','ACCOUNT_CONTACT_HMAC_KEY',
 'ACCOUNT_CONTACT_ENCRYPTION_KEY',
] as const;
function withEnv<T>(values:Record<string,string>,f:()=>Promise<T>):Promise<T>{
 const saved=Object.fromEntries(envKeys.map(k=>[k,process.env[k]]));
 for(const key of envKeys){
  if(values[key]===undefined)delete process.env[key];
  else process.env[key]=values[key];
 }
 return f().finally(()=>{
  for(const key of envKeys){
   if(saved[key]===undefined)delete process.env[key];
   else process.env[key]=saved[key];
  }
 });
}
const sec=()=>randomBytes(32).toString('base64');
const baseEnv=()=>({
 SERVICES_ENABLE_ACCOUNT_LOGIN_HTTP:'enabled',
 SERVICES_ENABLE_ACCOUNT_OTP_DISPATCH_HTTP:'enabled',
 ACCOUNT_LOGIN_BFF_KEY:sec(),ACCOUNT_NETWORK_ATTESTATION_KEY:sec(),
 ACCOUNT_OTP_HMAC_KEY:sec(),ACCOUNT_CONTACT_HMAC_KEY:sec(),
 ACCOUNT_CONTACT_ENCRYPTION_KEY:sec(),
});
function signed(digest:string,secret:Buffer){
 const timestamp=String(Date.now());
 const mac=createHmac('sha256',secret)
  .update('services-otp-network:v1\n').update(digest)
  .update('\n').update(timestamp).digest('hex');
 return 'v1.'+digest+'.'+timestamp+'.'+mac;
}
const body={
 channel:'EMAIL',purpose:'SIGN_IN',locale:'kk',
 contact:'private-dispatch-'+randomUUID()+'@example.test',
};
test('private issuance requires independent rollout, trusted BFF key and exact body before service',async()=>{
 let calls=0;
 const controller=new AccountOtpDispatchPrivateController({
  dispatch:async()=>{calls++;throw Error('unexpected');},
 } as never);
 const env=baseEnv(),secret=env.ACCOUNT_LOGIN_BFF_KEY;
 await withEnv(env,async()=>{
  for(const invalid of [undefined,'invalid',sec()]){
   await assert.rejects(controller.issue(invalid,'v1.invalid',body),
    NotFoundException);
  }
  for(const invalid of [
   null,{},[],{...body,person_id:randomUUID()},
   {...body,contact:null},{...body,locale:'en'},
   {...body,purpose:'RESET_PASSWORD'},{...body,channel:'PUSH'},
  ]){
   await assert.rejects(controller.issue(secret,'valid',invalid),
    ServiceUnavailableException);
  }
  for(const invalid of [null,undefined,'x'.repeat(161)]){
   await assert.rejects(controller.issue(secret,invalid,body),
    ServiceUnavailableException);
  }
  assert.equal(calls,0,'unauthorized inputs must not call dispatch');
  delete process.env.SERVICES_ENABLE_ACCOUNT_OTP_DISPATCH_HTTP;
  await assert.rejects(controller.issue(secret,'valid',body),NotFoundException);
  assert.equal(calls,0);
 });
});
test('real Nest HTTP denies default-off and unauthorized callers without dispatch',async()=>{
 const key=sec(),env=baseEnv();
 env.ACCOUNT_LOGIN_BFF_KEY=key;
 await withEnv(env,async()=>{
  let calls=0;
  const stub={dispatch:async()=>{
   calls++;return {challengeId:randomUUID(),expiresInSeconds:300};
  }};
  @Module({
   controllers:[AccountOtpDispatchPrivateController],
   providers:[{provide:AccountOtpDispatchService,useValue:stub}],
  })
  class TestPrivateDispatchModule{}
  const app=await NestFactory.create(TestPrivateDispatchModule,{logger:false});
  app.setGlobalPrefix('v1');
  await app.listen(0,'127.0.0.1');
  try{
   const url=(await app.getUrl())+'/v1/auth/private/account/challenges';
   const request=(access?:string,payload:unknown=body,proof='untrusted')=>
    fetch(url,{method:'POST',redirect:'manual',headers:{
     'Content-Type':'application/json',
     ...(access?{'X-Services-Account-Login-Key':access}:{}),
     'X-Services-Network-Proof':proof,
    },body:JSON.stringify(payload)});
   delete process.env.SERVICES_ENABLE_ACCOUNT_OTP_DISPATCH_HTTP;
   const off=await request(key);
   assert.equal(off.status,404);
   process.env.SERVICES_ENABLE_ACCOUNT_OTP_DISPATCH_HTTP='enabled';
   const untrusted=await request(sec());
   assert.equal(untrusted.status,404);
   const noAccess=await request();
   assert.equal(noAccess.status,404);
   const bad=await request(key,{...body,code:'123456'});
   assert.equal(bad.status,503);
   assert.equal(calls,0);
   const accepted=await request(key);
   assert.equal(accepted.status,201);
   assert.match(accepted.headers.get('cache-control')??'',/no-store/);
   const receipt=await accepted.json();
   assert.deepEqual(Object.keys(receipt).sort(),
    ['challenge_id','expires_in_seconds']);
   assert.equal(receipt.expires_in_seconds,300);
   assert.equal(calls,1);
   const serialized=JSON.stringify(receipt);
   assert.equal(serialized.includes(body.contact),false);
   assert.equal(serialized.includes('untrusted'),false);
   assert.equal(accepted.headers.get('set-cookie'),null);
  }finally{await app.close();}
 });
});

test('real PostgreSQL dispatch proves accepted challenge, opaque receipt and network quota',async()=>{
 const env=baseEnv(),secret=env.ACCOUNT_LOGIN_BFF_KEY;
 await withEnv(env,async()=>{
  const client=new Client({connectionString:process.env.DATABASE_URL});
  await client.connect();await client.query('BEGIN');
  try{
   const db={
    transaction:async <T>(f:(db:Client)=>Promise<T>)=>f(client),
    query:<T extends import('pg').QueryResultRow>(
     sql:string,values:unknown[])=>client.query<T>(sql,values),
   };
   let deliveries=0;
   let sentCode='';
   const service=new AccountOtpDispatchService(db as never,{
    deliver:async dispatched=>{
     deliveries++;
     assert.equal(dispatched.destination,body.contact);
     assert.equal(dispatched.locale,'kk');
     assert.equal(dispatched.purpose,'SIGN_IN');
     sentCode=dispatched.code;
     return {accepted:true,providerRef:'private_http_accepted_123'};
    },
   });
   const controller=new AccountOtpDispatchPrivateController(service);
   const digest=randomBytes(32).toString('hex');
   const proof=signed(digest,Buffer.from(env.ACCOUNT_NETWORK_ATTESTATION_KEY,'base64'));
   const result=await controller.issue(secret,proof,body);
   assert.deepEqual(Object.keys(result).sort(),['challenge_id','expires_in_seconds']);
   assert.equal(result.expires_in_seconds,300);
   assert.equal(deliveries,1);
   assert.equal(JSON.stringify(result).includes(sentCode),false);
   assert.equal(JSON.stringify(result).includes(body.contact),false);
   assert.equal(JSON.stringify(result).includes(digest),false);
   const challenge=await client.query<{
    consumed_at:Date|null;delivery_confirmed_at:Date|null;contact_cipher:string;
   }>(`SELECT consumed_at,delivery_confirmed_at,contact_cipher
      FROM account_auth_challenges WHERE id=$1::uuid`,[result.challenge_id]);
   assert.equal(challenge.rows[0]?.consumed_at,null);
   assert.ok(challenge.rows[0]?.delivery_confirmed_at);
   assert.ok(!challenge.rows[0]?.contact_cipher.includes(body.contact));
   const quota=await client.query<{n:string}>(`
    SELECT count(*)::text AS n FROM account_otp_network_issuances
    WHERE network_digest=$1`,[digest]);
   assert.equal(quota.rows[0]?.n,'1');
   const before=await client.query<{n:string}>(`
    SELECT count(*)::text AS n FROM account_auth_challenges
    WHERE id=$1::uuid`,[result.challenge_id]);
   assert.equal(before.rows[0]?.n,'1');
   await assert.rejects(
    controller.issue(secret,signed(digest,randomBytes(32)),body),
    ServiceUnavailableException);
   assert.equal(deliveries,1,'forged signed proof must not reach provider');
  }finally{
   await client.query('ROLLBACK').catch(()=>{});await client.end();
  }
 });
});
test('default disabled delivery cannot issue redeemable challenge',async()=>{
 const env=baseEnv();
 await withEnv(env,async()=>{
  const client=new Client({connectionString:process.env.DATABASE_URL});
  await client.connect();await client.query('BEGIN');
  try{
   const db={
    transaction:async <T>(f:(db:Client)=>Promise<T>)=>f(client),
    query:<T extends import('pg').QueryResultRow>(
     sql:string,values:unknown[])=>client.query<T>(sql,values),
   };
   const controller=new AccountOtpDispatchPrivateController(
    new AccountOtpDispatchService(db as never));
   const proof=signed(randomBytes(32).toString('hex'),
    Buffer.from(env.ACCOUNT_NETWORK_ATTESTATION_KEY,'base64'));
   const address='disabled-'+randomUUID()+'@example.test';
   await assert.rejects(
    controller.issue(env.ACCOUNT_LOGIN_BFF_KEY,proof,
     {...body,contact:address}),
    ServiceUnavailableException);
   const contactDigest=createHmac('sha256',Buffer.from(
    env.ACCOUNT_CONTACT_HMAC_KEY,'base64'))
    .update('services-account-contact:v1').update(String.fromCharCode(0)).update('EMAIL')
    .update(String.fromCharCode(0)).update(address).digest('hex');
   const record=await client.query<{
    consumed_at:Date|null;delivery_confirmed_at:Date|null;
   }>(`
    SELECT consumed_at,delivery_confirmed_at FROM account_auth_challenges
    WHERE contact_digest=$1
   `,[contactDigest]);
   assert.equal(record.rows.length,1);
   assert.ok(record.rows[0]?.consumed_at,
    'disabled delivery must immediately revoke its issued challenge');
   assert.equal(record.rows[0]?.delivery_confirmed_at,null,
    'disabled provider must not leave redeemable OTP');
  }finally{
   await client.query('ROLLBACK').catch(()=>{});await client.end();
  }
 });
});
