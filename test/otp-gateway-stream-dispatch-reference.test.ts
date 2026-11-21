import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {OtpHttpsGatewayAdapter} from '../src/modules/guest-requests/otp-https-gateway.adapter.js';
import {OtpGatewayLedgerDispatchReference} from
 '../src/platform/ingress/otp-gateway-ledger-dispatch.reference.js';
import {dispatchBoundedOtpGatewayHttpStream} from
 '../src/platform/ingress/otp-gateway-stream-dispatch.reference.js';

const config={apiToken:'fixture'.repeat(8),idempotencySecret:Buffer.alloc(32,42)};
const msg={
 channel:'email' as const,destination:'person@example.org',
 code:'123456',purpose:'CREATE_REQUEST' as const,
 locale:'kk' as const,expiresInSeconds:600,challengeId:randomUUID(),
};

test('composed OTP HTTP gateway validates stream before claiming ledger and vendor',async()=>{
 let claims=0;
 let sends=0;
 const gateway=new OtpGatewayLedgerDispatchReference({
  claim:async()=>{claims++;return {decision:'send' as const};},
  recordAccepted:async()=>true,
 });
 const adapter=new OtpHttpsGatewayAdapter({
  ...config,endpoint:'https://otp.example.org/v1/send',approvedHost:'otp.example.org',
  transport:async(_url,init)=>{
   const body=Buffer.from(String(init?.body),'utf8');
   const headers:[string,string][]=[
    ...new Headers(init?.headers).entries(),['content-length',String(body.length)],
   ];
   async function* pieces(){yield body.subarray(0,7);yield body.subarray(7);}
   const receipt=await dispatchBoundedOtpGatewayHttpStream(
    'POST','/v1/send',headers,pieces(),config,gateway,payload=>({
     sendOnce:async()=>{
      sends++;
      assert.equal(payload.code,msg.code);
      return {accepted:true,providerRef:'provider_12345678'};
     },
    }),
   );
   assert.equal(receipt.status,'accepted');
   return new Response(JSON.stringify({accepted:true,providerRef:'provider_12345678'}),{
    status:202,headers:{'content-type':'application/json'},
   });
  },
 });
 assert.deepEqual(await adapter.deliverOtp(msg),
  {accepted:true,providerRef:'provider_12345678'});
 assert.equal(claims,1);
 assert.equal(sends,1);
});

test('composed OTP HTTP stream denies broken envelope without ledger/vendor side effects',async()=>{
 let claims=0;
 let vendors=0;
 let templateHeaders:[string,string][]=[];
 let raw=Buffer.alloc(0);
 const adapter=new OtpHttpsGatewayAdapter({
  ...config,endpoint:'https://otp.example.org/v1/send',approvedHost:'otp.example.org',
  transport:async(_url,init)=>{
   raw=Buffer.from(String(init?.body));
   templateHeaders=[
    ...new Headers(init?.headers).entries(),['content-length',String(raw.length)],
   ];
   return new Response(JSON.stringify({accepted:true,providerRef:'provider_12345678'}),{
    status:202,headers:{'content-type':'application/json'},
   });
  },
 });
 await adapter.deliverOtp(msg);
 const gateway=new OtpGatewayLedgerDispatchReference({
  claim:async()=>{claims++;return {decision:'send' as const};},
  recordAccepted:async()=>true,
 });
 const deny=async(method:string,path:string,headers:[string,string][],body:Buffer)=>{
  async function* stream(){yield body;}
  await assert.rejects(dispatchBoundedOtpGatewayHttpStream(
   method,path,headers,stream(),config,gateway,()=>{vendors++;return {
    sendOnce:async()=>({accepted:true,providerRef:'provider_12345678'}),
   };},
  ),/otp_gateway_request_rejected/);
 };
 await deny('GET','/v1/send',templateHeaders,raw);
 await deny('POST','/v1/send?x=1',templateHeaders,raw);
 await deny('POST','/v1/send',templateHeaders,Buffer.alloc(1025));
 await deny('POST','/v1/send',[...templateHeaders,
  ['Authorization',templateHeaders.find(([k])=>k==='authorization')?.[1]??'']],raw);
 await deny('POST','/v1/send',templateHeaders,Buffer.from(raw.toString()+' '));
 const tampered=templateHeaders.map(([key,value])=>
  [key,key==='authorization'?'Bearer '+'x'.repeat(48):value] as [string,string]);
 await deny('POST','/v1/send',tampered,raw);
 assert.equal(claims,0);
 assert.equal(vendors,0);
});

test('composed gateway denies pre-aborted streams before vendor or ledger',async()=>{
 let claims=0;
 const gateway=new OtpGatewayLedgerDispatchReference({
  claim:async()=>{claims++;return {decision:'send' as const};},
  recordAccepted:async()=>true,
 });
 const ac=new AbortController();ac.abort();
 let consumed=false;
 async function* stream(){consumed=true;yield Buffer.from('a');}
 await assert.rejects(dispatchBoundedOtpGatewayHttpStream(
  'POST','/v1/send',[],stream(),config,gateway,
  ()=>{throw new Error('vendor called');},ac.signal,
 ),/otp_gateway_request_rejected/);
 assert.equal(consumed,false);
 assert.equal(claims,0);
});
