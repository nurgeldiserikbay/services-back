import assert from 'node:assert/strict';
import {test} from 'node:test';
import {OtpHttpsGatewayAdapter} from '../src/modules/guest-requests/otp-https-gateway.adapter.js';

const config={
 endpoint:'https://otp.example.org/v1/send',
 approvedHost:'otp.example.org',
 apiToken:'fixture'.repeat(8),
};
const message={
 channel:'email' as const,destination:'example@example.org',
 code:'123456',purpose:'CREATE_REQUEST' as const,
 locale:'kk' as const,expiresInSeconds:600,
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
