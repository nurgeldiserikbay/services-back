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
