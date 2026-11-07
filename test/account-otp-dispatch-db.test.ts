import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHmac,randomBytes} from 'node:crypto';
import {Client} from 'pg';
import {ServiceUnavailableException} from '@nestjs/common';
import {AccountOtpDispatchService}
  from '../src/modules/identity/account-otp-dispatch.service.js';
import {AccountOtpTemplateDeliveryAdapter}
  from '../src/modules/identity/account-otp-template-delivery.adapter.js';

const keys=[
  'ACCOUNT_NETWORK_ATTESTATION_KEY',
  'ACCOUNT_OTP_HMAC_KEY',
  'ACCOUNT_CONTACT_HMAC_KEY',
  'ACCOUNT_CONTACT_ENCRYPTION_KEY',
] as const;
type Keys=Record<(typeof keys)[number],string>;
function freshKeys():Keys{
  return Object.fromEntries(keys.map(k=>[k,randomBytes(32).toString('base64')])) as Keys;
}
async function withSecrets<T>(work:(key:Buffer)=>Promise<T>):Promise<T>{
  const old=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
  const current=freshKeys();
  for(const k of keys)process.env[k]=current[k];
  try{return await work(Buffer.from(current.ACCOUNT_NETWORK_ATTESTATION_KEY,'base64'));}
  finally{
    for(const k of keys){
      const before=old[k];
      if(before===undefined)delete process.env[k];
      else process.env[k]=before;
    }
  }
}
function signed(key:Buffer,digest:string){
 const stamp=String(Date.now());
 const signature=createHmac('sha256',key)
   .update('services-otp-network:v1\n').update(digest)
   .update('\n').update(stamp).digest('hex');
 return 'v1.'+digest+'.'+stamp+'.'+signature;
}
const digest=()=>randomBytes(32).toString('hex');
const request=(proof:unknown)=>({
  channel:'EMAIL' as const,purpose:'SIGN_IN' as const,
  contact:'account-dispatch@example.com',locale:'kk' as const,
  networkProof:proof,
});
async function dbReady(){
  const client=new Client({connectionString:process.env.DATABASE_URL});
  await client.connect();await client.query('BEGIN');
  const db={
    transaction:async <T>(run:(client:Client)=>Promise<T>)=>run(client),
    query:<T extends import('pg').QueryResultRow>(sql:string,params:unknown[])=>
      client.query<T>(sql,params),
  };
  return {client,db};
}

test('account dispatch requires signed trusted network and never calls DB for forged proof',async()=>{
 await withSecrets(async key=>{
   let hits=0;
   const db={
     transaction:async()=>{hits++;throw new Error('not expected');},
     query:async()=>{hits++;throw new Error('not expected');},
   };
   const service=new AccountOtpDispatchService(db as never,{
     deliver:async()=>{throw new Error('not expected');},
   });
   for(const proof of [undefined,'x-forwarded-for: 127.0.0.1',
      signed(randomBytes(32),digest())]){
     await assert.rejects(service.dispatch(request(proof)),ServiceUnavailableException);
   }
   assert.equal(hits,0);
   assert.equal(typeof signed(key,digest()),'string');
 });
});

test('accepted account dispatch persists only encrypted challenge and digest budget',async()=>{
 await withSecrets(async key=>{
   const {client,db}=await dbReady();
   try{
     let sent=0;
     const service=new AccountOtpDispatchService(db as never,{
       deliver:async message=>{
         sent++;
         assert.match(message.code,/^[0-9]{6}$/);
         assert.equal(message.destination,'account-dispatch@example.com');
         assert.equal(message.locale,'kk');
         return {accepted:true,providerRef:'provider_12345'};
       },
     });
     const network=digest();
     const result=await service.dispatch(request(signed(key,network)));
     assert.equal(sent,1);
     assert.deepEqual(Object.keys(result).sort(),['challengeId','expiresInSeconds']);
     assert.equal(result.expiresInSeconds,300);
     const row=await client.query<{consumed_at:Date|null;delivery_confirmed_at:Date|null;contact_cipher:string;code_hash:string}>(
       'SELECT consumed_at,delivery_confirmed_at,contact_cipher,code_hash FROM account_auth_challenges WHERE id=$1',
       [result.challengeId]);
     assert.equal(row.rows[0].consumed_at,null);
     assert.ok(row.rows[0].delivery_confirmed_at);
     assert.equal(row.rows[0].contact_cipher.includes('account-dispatch@example.com'),false);
     assert.equal(row.rows[0].code_hash.length,64);
     const count=await client.query<{total:string}>(`
       SELECT count(*)::text AS total FROM account_otp_network_issuances
       WHERE network_digest=$1`,[network]);
     assert.equal(count.rows[0].total,'1');
   }finally{await client.query('ROLLBACK').catch(()=>{});await client.end();}
 });
});

test('failed or rejected delivery revokes proof but retains send budget',async()=>{
 await withSecrets(async key=>{
   const {client,db}=await dbReady();
   try{
     const network=digest();
     let deliveredId:string|undefined;
     const service=new AccountOtpDispatchService(db as never,{
       deliver:async message=>{
         deliveredId=message.challengeId;
         return {accepted:false,providerRef:null};
       },
     });
     await assert.rejects(service.dispatch(request(signed(key,network))),
       ServiceUnavailableException);
     assert.ok(deliveredId);
     const row=await client.query<{consumed_at:Date|null;delivery_confirmed_at:Date|null}>(`
       SELECT consumed_at,delivery_confirmed_at FROM account_auth_challenges WHERE id=$1
     `,[deliveredId]);
     assert.ok(row.rows[0].consumed_at);
     assert.equal(row.rows[0].delivery_confirmed_at,null);
     const count=await client.query<{total:string}>(`
       SELECT count(*)::text AS total FROM account_otp_network_issuances
       WHERE network_digest=$1`,[network]);
     assert.equal(count.rows[0].total,'1');
   }finally{await client.query('ROLLBACK').catch(()=>{});await client.end();}
 });
});

test('default-disabled provider fails closed and revokes committed challenge',async()=>{
 await withSecrets(async key=>{
   const {client,db}=await dbReady();
   try{
     const service=new AccountOtpDispatchService(db as never);
     await assert.rejects(service.dispatch(request(signed(key,digest()))),
       ServiceUnavailableException);
     const record=await client.query<{consumed_at:Date|null;delivery_confirmed_at:Date|null}>(`
       SELECT consumed_at,delivery_confirmed_at FROM account_auth_challenges
       WHERE contact_cipher LIKE 'v1.%'
       ORDER BY created_at DESC LIMIT 1
     `);
     assert.ok(record.rows[0]?.consumed_at);
     assert.equal(record.rows[0]?.delivery_confirmed_at,null);
   }finally{await client.query('ROLLBACK').catch(()=>{});await client.end();}
 });
});

test('timed-out OTP provider leaves committed challenge consumed and delivery unconfirmed',async()=>{
 await withSecrets(async key=>{
   const {client,db}=await dbReady();
   let resolveLate!: (value:{accepted:boolean;providerRef:string|null})=>void;
   const late=new Promise<{accepted:boolean;providerRef:string|null}>(resolve=>{
     resolveLate=resolve;
   });
   let issuedId:string|undefined;
   try{
     const network=digest();
     const service=new AccountOtpDispatchService(db as never,{
       deliver:async message=>{
         issuedId=message.challengeId;
         return late;
       },
     },15);
     await assert.rejects(service.dispatch(request(signed(key,network))),
       ServiceUnavailableException);
     assert.ok(issuedId);
     const row=await client.query<{
       consumed_at:Date|null;delivery_confirmed_at:Date|null;
     }>('SELECT consumed_at,delivery_confirmed_at FROM account_auth_challenges WHERE id=$1',
       [issuedId]);
     assert.ok(row.rows[0].consumed_at);
     assert.equal(row.rows[0].delivery_confirmed_at,null);
     const count=await client.query<{total:string}>(`
       SELECT count(*)::text AS total FROM account_otp_network_issuances
        WHERE network_digest=$1`,[network]);
     assert.equal(count.rows[0].total,'1');
     // Provider success after timeout does not flip the acceptance gate.
     resolveLate({accepted:true,providerRef:'late_provider_1234'});
     await late;
     const after=await client.query<{
       consumed_at:Date|null;delivery_confirmed_at:Date|null;
     }>('SELECT consumed_at,delivery_confirmed_at FROM account_auth_challenges WHERE id=$1',
       [issuedId]);
     assert.ok(after.rows[0].consumed_at);
     assert.equal(after.rows[0].delivery_confirmed_at,null);
   }finally{
     resolveLate?.({accepted:false,providerRef:null});
     await client.query('ROLLBACK').catch(()=>{});
     await client.end();
   }
 });
});

test('template adapter acceptance confirms only provider-accepted account OTP proof',async()=>{
 await withSecrets(async key=>{
   const {client,db}=await dbReady();
   try{
     let calls=0;
     let deliveredCode='';
     const provider=new AccountOtpTemplateDeliveryAdapter(async(message,nonce)=>{
       calls++;
       assert.equal(message.destination,'account-dispatch@example.com');
       assert.equal(message.channel,'EMAIL');
       assert.match(message.text,/5 минут/);
       assert.match(nonce,/^[A-Za-z0-9_-]{43}$/);
       const matches=message.text.match(/\d{6}/g)??[];
       assert.equal(matches.length,1);
       deliveredCode=matches[0];
       return {accepted:true,providerRef:'accepted_12345678'};
     },randomBytes(32));
     const service=new AccountOtpDispatchService(db as never,provider,100);
     const result=await service.dispatch(request(signed(key,digest())));
     assert.equal(calls,1);
     assert.deepEqual(Object.keys(result).sort(),['challengeId','expiresInSeconds']);
     assert.equal(result.expiresInSeconds,300);
     assert.equal(JSON.stringify(result).includes(deliveredCode),false);
     assert.equal(JSON.stringify(result).includes('account-dispatch@example.com'),false);
     const row=await client.query<{
       consumed_at:Date|null;delivery_confirmed_at:Date|null;
     }>('SELECT consumed_at,delivery_confirmed_at FROM account_auth_challenges WHERE id=$1',
       [result.challengeId]);
     assert.equal(row.rows[0].consumed_at,null);
     assert.ok(row.rows[0].delivery_confirmed_at);
   }finally{await client.query('ROLLBACK').catch(()=>{});await client.end();}
 });
});

test('template adapter malformed provider receipt consumes challenge and retains quota',async()=>{
 await withSecrets(async key=>{
   const {client,db}=await dbReady();
   try{
     let attempts=0;
     const provider=new AccountOtpTemplateDeliveryAdapter(async()=>{
       attempts++;
       return {accepted:true,providerRef:'receipt_12345678',untrusted:'secret'};
     },randomBytes(32));
     const network=digest();
     const service=new AccountOtpDispatchService(db as never,provider,100);
     await assert.rejects(service.dispatch(request(signed(key,network))),
       ServiceUnavailableException);
     assert.equal(attempts,1);
     const row=await client.query<{
       consumed_at:Date|null;delivery_confirmed_at:Date|null;
     }>('SELECT consumed_at,delivery_confirmed_at FROM account_auth_challenges ORDER BY created_at DESC LIMIT 1');
     assert.ok(row.rows[0].consumed_at);
     assert.equal(row.rows[0].delivery_confirmed_at,null);
     const quota=await client.query<{count:string}>(`
       SELECT count(*)::text AS count FROM account_otp_network_issuances
       WHERE network_digest=$1`,[network]);
     assert.equal(quota.rows[0].count,'1');
   }finally{await client.query('ROLLBACK').catch(()=>{});await client.end();}
 });
});
