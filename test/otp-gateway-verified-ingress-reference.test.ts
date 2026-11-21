import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {OtpHttpsGatewayAdapter} from '../src/modules/guest-requests/otp-https-gateway.adapter.js';
import {OtpGatewayLedgerDispatchReference} from
 '../src/platform/ingress/otp-gateway-ledger-dispatch.reference.js';
import {
 verifyTrustedOtpGatewayRequest,dispatchVerifiedOtpGatewayRequest,
} from '../src/platform/ingress/otp-gateway-verified-request.reference.js';

const config={
  apiToken:'fixture'.repeat(8),
  idempotencySecret:Buffer.alloc(32,42),
};
const msg={
 channel:'email' as const,destination:'person@example.org',
 code:'123456',purpose:'CREATE_REQUEST' as const,
 locale:'kk' as const,expiresInSeconds:600,
 challengeId:randomUUID(),
};
const accepted={
 status:'accepted' as const,providerRef:'provider_12345678',
};

test('gateway verifies exactly the real HTTPS adapter signed request',async()=>{
 let observed=0;
 const ledger={
  claim:async()=>({decision:'send' as const}),
  recordAccepted:async()=>true,
 };
 const gateway=new OtpGatewayLedgerDispatchReference(ledger);
 const adapter=new OtpHttpsGatewayAdapter({
  ...config,endpoint:'https://otp.example.org/v1/send',
  approvedHost:'otp.example.org',
  transport:async(_url,init)=>{
   const headers=new Headers(init?.headers);
   const raw=String(init?.body);
   const verified=verifyTrustedOtpGatewayRequest(headers,raw,config);
   assert.deepEqual(verified.payload,{
    channel:msg.channel,destination:msg.destination,code:msg.code,
    purpose:msg.purpose,locale:msg.locale,expiresInSeconds:600,
   });
   assert.match(verified.idempotencyKey,/^[a-f0-9]{64}$/);
   const result=await dispatchVerifiedOtpGatewayRequest(
    headers,raw,config,gateway,payload=>({
     sendOnce:async()=>{
      observed++;
      assert.equal(payload.destination,msg.destination);
      return {accepted:true,providerRef:accepted.providerRef};
     },
    }),
   );
   assert.deepEqual(result,accepted);
   return new Response(JSON.stringify({accepted:true,providerRef:result.providerRef}),{
    status:202,headers:{'content-type':'application/json'},
   });
  },
 });
 const receipt=await adapter.deliverOtp(msg);
 assert.deepEqual(receipt,{accepted:true,providerRef:accepted.providerRef});
 assert.equal(observed,1);
});

test('tampered JSON, auth, signature and ambiguous encodings fail before ledger and vendor',async()=>{
 let ledgerCalls=0;
 let vendorCalls=0;
 const gateway=new OtpGatewayLedgerDispatchReference({
  claim:async()=>{ledgerCalls++;return {decision:'send' as const};},
  recordAccepted:async()=>true,
 });
 let validHeaders:Headers|undefined;
 let validBody='';
 const adapter=new OtpHttpsGatewayAdapter({
  ...config,endpoint:'https://otp.example.org/v1/send',
  approvedHost:'otp.example.org',
  transport:async(_url,init)=>{
   validHeaders=new Headers(init?.headers);
   validBody=String(init?.body);
   return new Response(JSON.stringify({accepted:true,providerRef:'provider_12345678'}),{
    status:202,headers:{'content-type':'application/json'},
   });
  },
 });
 await adapter.deliverOtp(msg);
 assert.ok(validHeaders);
 const variants:{headers:Headers;body:string;settings?:typeof config}[]=[];
 const edit=(name:string,value:string)=>{
  const headers=new Headers(validHeaders);headers.set(name,value);
  variants.push({headers,body:validBody});
 };
 edit('authorization','Bearer '+'wrong'.repeat(10));
 edit('idempotency-key','f'.repeat(64));
 edit('x-services-otp-payload-fingerprint','0'.repeat(64));
 edit('content-type','text/plain');
 edit('x-services-otp-payload-fingerprint','0'.repeat(63));
 variants.push({headers:new Headers(validHeaders),body:validBody.replace('123456','654321')});
 variants.push({headers:new Headers(validHeaders),body:validBody+' '});
 variants.push({headers:new Headers(validHeaders),body:validBody.replace(
   '"code":"123456"', '"code":"123456","code":"123456"')});
 variants.push({headers:new Headers(validHeaders),body:validBody.replace(
   '"code":"123456"', '"code":"123456","extra":true')});
 variants.push({headers:new Headers(validHeaders),body:' '.repeat(1025)});
 variants.push({headers:new Headers(validHeaders),body:validBody,
  settings:{...config,idempotencySecret:Buffer.alloc(32,1)}});
 for(const item of variants){
  await assert.rejects(dispatchVerifiedOtpGatewayRequest(
   item.headers,item.body,item.settings??config,gateway,
   ()=>({sendOnce:async()=>{vendorCalls++;return {
    accepted:true as const,providerRef:accepted.providerRef,
   };}}),
  ),error=>error instanceof Error&&error.message==='otp_gateway_request_rejected');
 }
 assert.equal(ledgerCalls,0);
 assert.equal(vendorCalls,0);
});

test('gateway request wrapper rejects aborted signals before reserving',async()=>{
 const abort=new AbortController();abort.abort();
 let calls=0;
 const gateway=new OtpGatewayLedgerDispatchReference({
  claim:async()=>{calls++;return {decision:'send' as const};},
  recordAccepted:async()=>true,
 });
 await assert.rejects(dispatchVerifiedOtpGatewayRequest(new Headers(),
  '{}',config,gateway,()=>({sendOnce:async()=>({
   accepted:true,providerRef:accepted.providerRef,
  })}),abort.signal),/otp_gateway_request_rejected/);
 assert.equal(calls,0);
});

test('gateway ingress reference is never imported into live Nest controllers',()=>{
 for(const path of [
  'src/main.ts','src/modules/guest-requests/guest-verification.module.ts',
  'src/modules/guest-requests/guest-otp-http.controller.ts',
 ]){
  assert.doesNotMatch(readFileSync(path,'utf8'),
   /otp-gateway-verified-request\.reference|dispatchVerifiedOtpGatewayRequest/);
 }
});
