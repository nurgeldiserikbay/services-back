import assert from 'node:assert/strict';
import {test} from 'node:test';
import {OtpHttpsGatewayAdapter} from '../src/modules/guest-requests/otp-https-gateway.adapter.js';

const config={
 endpoint:'https://otp.example.org/v1/send',
 approvedHost:'otp.example.org',
 apiToken:'fixture'.repeat(8),
 idempotencySecret:Buffer.alloc(32,42),
};
const message={
 channel:'email' as const,destination:'example@example.org',
 code:'123456',purpose:'CREATE_REQUEST' as const,
 locale:'kk' as const,expiresInSeconds:600,
 challengeId:'f20c341a-6387-4b71-905e-7c0b54901bb0',
};

test('HTTPS adapter accepts a narrowly scoped provider receipt',async()=>{
 const adapter=new OtpHttpsGatewayAdapter({...config,
  transport:async()=>new Response(JSON.stringify({
   accepted:true,providerRef:'delivery_12345678',
  }),{status:202,headers:{'content-type':'application/json'}}),
 });
 const receipt=await adapter.deliverOtp(message);
 assert.deepEqual(receipt,{accepted:true,providerRef:'delivery_12345678'});
});

test('HTTPS adapter rejects redirects and invalid outcomes',async()=>{
 const adapter=new OtpHttpsGatewayAdapter({...config,
  transport:async()=>new Response('not accepted',{
   status:503,headers:{'content-type':'text/plain'},
  }),
 });
 await assert.rejects(adapter.deliverOtp(message),/otp_gateway_unavailable/);
});

test('gateway requires approved HTTPS host and safe request path',()=>{
 for(const endpoint of [
  'http://otp.example.org/v1/send',
  'https://different.example.org/v1/send',
  'https://otp.example.org:8443/v1/send',
  'https://otp.example.org/v1/send?bad=yes',
  'https://otp.example.org/',
  'https://127.0.0.1/v1/send',
 ]){
  assert.throws(()=>new OtpHttpsGatewayAdapter({...config,endpoint}),
   /otp_gateway_unavailable/);
 }
});

test('gateway rejects ambiguous or cacheable response contracts',async()=>{
 const values:ResponseInit[]=[
  {status:200,headers:{'content-type':'application/json'}},
  {status:202,headers:{'content-type':'text/html'}},
  {status:202,headers:{'content-type':'application/json','cache-control':'public'}},
  {status:202,headers:{'content-type':'application/json','content-length':'1000'}},
 ];
 for(const setup of values){
  const adapter=new OtpHttpsGatewayAdapter({...config,
   transport:async()=>new Response(JSON.stringify({
    accepted:true,providerRef:'delivery_12345678',
   }),setup),
  });
  await assert.rejects(adapter.deliverOtp(message),/otp_gateway_unavailable/);
 }
});

test('pre-canceled request does not start network transport',async()=>{
 let calls=0;
 const cancellation=new AbortController();
 cancellation.abort();
 const gateway=new OtpHttpsGatewayAdapter({...config,
  transport:async()=>{calls++;return new Response(null,{status:204});},
 });
 await assert.rejects(gateway.deliverOtp(message,cancellation.signal),
  /otp_gateway_unavailable/);
 assert.equal(calls,0);
});

test('external abort bounds transport that ignores its signal',async()=>{
 const controller=new AbortController();
 let entered=false;
 const adapter=new OtpHttpsGatewayAdapter({...config,transport:async()=>{
  entered=true;
  return await new Promise<Response>(()=>{});
 }});
 const pending=adapter.deliverOtp(message,controller.signal);
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(entered,true);
 controller.abort();
 await assert.rejects(pending,/otp_gateway_unavailable/);
});

test('external abort bounds a stalled provider response stream',async()=>{
 const controller=new AbortController();
 let cancelled=0;
 let firstRead=true;
 const stream=new ReadableStream<Uint8Array>({
  pull(streamController){
   if(firstRead){
    firstRead=false;
    streamController.enqueue(new TextEncoder().encode('{"accepted":'));
   }
  },
  cancel(){cancelled++;}
 });
 const adapter=new OtpHttpsGatewayAdapter({...config,transport:async()=>
  new Response(stream,{status:202,headers:{'content-type':'application/json'}}),
 });
 const pending=adapter.deliverOtp(message,controller.signal);
 await new Promise(resolve=>setImmediate(resolve));
 controller.abort();
 await assert.rejects(pending,/otp_gateway_unavailable/);
 assert.equal(cancelled,1);
});

test('oversize response stream is cancelled before parsing',async()=>{
 let cancelled=0;
 const stream=new ReadableStream<Uint8Array>({
  start(ctrl){ctrl.enqueue(new Uint8Array(513));},
  cancel(){cancelled++;}
 });
 const adapter=new OtpHttpsGatewayAdapter({...config,transport:async()=>
  new Response(stream,{status:202,headers:{'content-type':'application/json'}}),
 });
 await assert.rejects(adapter.deliverOtp(message),/otp_gateway_unavailable/);
 assert.equal(cancelled,1);
});

test('gateway uses stable non-PII idempotency key for retries and different key for new challenge',async()=>{
 const seen:{key:string;body:Record<string,unknown>}[]=[];
 const transport:typeof fetch=async(_url,options)=>{
  const headers=new Headers(options?.headers);
  const key=headers.get('idempotency-key');
  assert.match(key??'',/^[0-9a-f]{64}$/);
  seen.push({key:key!,body:JSON.parse(String(options?.body)) as Record<string,unknown>});
  return new Response(JSON.stringify({accepted:true,providerRef:'delivery_12345678'}),{
   status:202,headers:{'content-type':'application/json'},
  });
 };
 const adapter=new OtpHttpsGatewayAdapter({...config,transport});
 await adapter.deliverOtp(message);
 await adapter.deliverOtp(message);
 await adapter.deliverOtp({...message,challengeId:'e6e9c6a5-eecb-42d2-95b7-6ae7e5e98e52'});
 assert.equal(seen.length,3);
 assert.equal(seen[0].key,seen[1].key);
 assert.notEqual(seen[0].key,seen[2].key);
 for(const entry of seen){
  assert.equal(entry.body.challengeId,undefined);
  assert.equal(entry.body.destination,message.destination);
  assert.equal(entry.body.code,message.code);
  assert.ok(!entry.key.includes(message.challengeId));
 }
});

test('gateway never dispatches without a committed challenge ID',async()=>{
 let calls=0;
 const adapter=new OtpHttpsGatewayAdapter({...config,transport:async()=>{
  calls++;
  return new Response(null,{status:204});
 }});
 for(const challengeId of [undefined,'','not-a-uuid']){
  await assert.rejects(adapter.deliverOtp({...message,challengeId}),
   /otp_gateway_unavailable/);
 }
 assert.equal(calls,0);
});

test('gateway rejects missing and invalid idempotency signing secret',()=>{
 for(const idempotencySecret of [Buffer.alloc(0),Buffer.alloc(16),Buffer.alloc(33)]){
  assert.throws(()=>new OtpHttpsGatewayAdapter({...config,idempotencySecret}),
   /otp_gateway_unavailable/);
 }
});

test('payload fingerprint is stable for identical retries and changes on conflicting payload',async()=>{
 const seen:{key:string;fingerprint:string;body:string}[]=[];
 const transport:typeof fetch=async(_url,init)=>{
  const headers=new Headers(init?.headers);
  const key=headers.get('idempotency-key')??'';
  const fingerprint=headers.get('x-services-otp-payload-fingerprint')??'';
  assert.match(key,/^[0-9a-f]{64}$/);
  assert.match(fingerprint,/^[0-9a-f]{64}$/);
  const body=String(init?.body);
  seen.push({key,fingerprint,body});
  return new Response(JSON.stringify({
   accepted:true,providerRef:'delivery_12345678',
  }),{status:202,headers:{'content-type':'application/json'}});
 };
 const adapter=new OtpHttpsGatewayAdapter({...config,transport});
 await adapter.deliverOtp(message);
 await adapter.deliverOtp(message);
 await adapter.deliverOtp({...message,code:'234567'});
 await adapter.deliverOtp({...message,destination:'another@example.org'});
 await adapter.deliverOtp({...message,challengeId:'e6e9c6a5-eecb-42d2-95b7-6ae7e5e98e52'});
 assert.equal(seen.length,5);
 assert.equal(seen[0].key,seen[1].key);
 assert.equal(seen[0].fingerprint,seen[1].fingerprint);
 assert.equal(seen[0].body,seen[1].body);
 assert.equal(seen[0].key,seen[2].key);
 assert.equal(seen[0].key,seen[3].key);
 assert.notEqual(seen[0].fingerprint,seen[2].fingerprint);
 assert.notEqual(seen[0].fingerprint,seen[3].fingerprint);
 assert.notEqual(seen[0].key,seen[4].key);
 assert.notEqual(seen[0].fingerprint,seen[4].fingerprint);
 for(const entry of seen){
  assert.ok(!entry.fingerprint.includes(message.code));
  assert.ok(!entry.fingerprint.includes(message.destination));
  assert.ok(!entry.body.includes(message.challengeId));
 }
});

test('reference gateway conflict handling requires same key and same fingerprint',async()=>{
 const stored=new Map<string,{fingerprint:string;receipt:string}>();
 let providerDispatches=0;
 const transport:typeof fetch=async(_url,init)=>{
  const h=new Headers(init?.headers);
  const key=h.get('idempotency-key')??'';
  const fingerprint=h.get('x-services-otp-payload-fingerprint')??'';
  const prior=stored.get(key);
  if(prior&&prior.fingerprint!==fingerprint){
   return new Response(null,{status:409});
  }
  if(!prior){
   providerDispatches++;
   stored.set(key,{fingerprint,receipt:'delivery_12345678'});
  }
  return new Response(JSON.stringify({
   accepted:true,providerRef:stored.get(key)!.receipt,
  }),{status:202,headers:{'content-type':'application/json'}});
 };
 const adapter=new OtpHttpsGatewayAdapter({...config,transport});
 assert.equal((await adapter.deliverOtp(message)).accepted,true);
 assert.equal((await adapter.deliverOtp(message)).accepted,true);
 await assert.rejects(adapter.deliverOtp({...message,code:'234567'}),
  /otp_gateway_unavailable/);
 assert.equal(providerDispatches,1);
});
