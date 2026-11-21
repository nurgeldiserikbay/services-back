import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {Readable} from 'node:stream';
import type {IncomingMessage} from 'node:http';
import {OtpHttpsGatewayAdapter} from '../src/modules/guest-requests/otp-https-gateway.adapter.js';
import {OtpGatewayLedgerDispatchReference} from
 '../src/platform/ingress/otp-gateway-ledger-dispatch.reference.js';
import {dispatchOtpNodeIncomingMessage} from
 '../src/platform/ingress/otp-gateway-node-incoming.reference.js';

const config={apiToken:'fixture'.repeat(8),idempotencySecret:Buffer.alloc(32,42)};
const msg={channel:'email' as const,destination:'person@example.org',code:'123456',
 purpose:'CREATE_REQUEST' as const,locale:'kk' as const,expiresInSeconds:600,
 challengeId:randomUUID()};

function incoming(body:Buffer,rawHeaders:string[]):IncomingMessage{
 const stream=Readable.from([body]) as IncomingMessage;
 Object.assign(stream,{
  method:'POST',url:'/v1/send',rawHeaders,aborted:false,
 });
 return stream;
}
function ledger(onClaim:()=>void){
 return new OtpGatewayLedgerDispatchReference({
  claim:async()=>{onClaim();return {decision:'send' as const};},
  recordAccepted:async()=>true,
 });
}
test('Node HTTP ingress reference accepts a canonical OTP adapter request',async()=>{
 let claims=0;
 let sends=0;
 const adapter=new OtpHttpsGatewayAdapter({
  ...config,endpoint:'https://otp.example.org/v1/send',approvedHost:'otp.example.org',
  transport:async(_url,init)=>{
   const raw=Buffer.from(String(init?.body));
   const headers=[...new Headers(init?.headers).entries()]
     .flatMap(([name,value])=>[name,value]);
   const req=incoming(raw,[...headers,'content-length',String(raw.length)]);
   const result=await dispatchOtpNodeIncomingMessage(req,config,
    ledger(()=>{claims++;}),payload=>({
     sendOnce:async()=>{
      sends++;
      assert.equal(payload.code,msg.code);
      return {accepted:true,providerRef:'provider_12345678'};
     },
    }),1_000);
   assert.equal(result.status,'accepted');
   return new Response(JSON.stringify({accepted:true,providerRef:'provider_12345678'}),{
    status:202,headers:{'content-type':'application/json'},
   });
  },
 });
 await adapter.deliverOtp(msg);
 assert.equal(claims,1);
 assert.equal(sends,1);
});
test('Node HTTP original duplicate Authorization rejected before reading body',async()=>{
 let claimed=0;
 const req=incoming(Buffer.from('ignored'),[
  'Authorization','Bearer '+'a'.repeat(48),
  'authorization','Bearer '+'b'.repeat(48),
  'Content-Length','7',
 ]);
 await assert.rejects(dispatchOtpNodeIncomingMessage(req,config,
  ledger(()=>{claimed++;}),()=>{throw new Error('vendor constructed');}),
  /otp_gateway_request_rejected/);
 assert.equal(claimed,0);
 assert.equal(req.readableFlowing,null);
});
test('Node HTTP ingress deadline destroys stalled input without claiming ledger',async()=>{
 let claimed=0;
 const stream=new Readable({read(){/* intentionally never produces bytes */}});
 const req=stream as IncomingMessage;
 Object.assign(req,{
  method:'POST',url:'/v1/send',aborted:false,
  rawHeaders:[
   'Authorization','Bearer '+'a'.repeat(48),
   'Idempotency-Key','a'.repeat(64),
   'X-Services-OTP-Payload-Fingerprint','b'.repeat(64),
   'Content-Type','application/json',
   'Content-Length','10',
  ],
 });
 await assert.rejects(dispatchOtpNodeIncomingMessage(req,config,
  ledger(()=>{claimed++;}),()=>{throw new Error('vendor constructed');},20),
  /otp_gateway_request_rejected/);
 assert.equal(req.destroyed,true);
 assert.equal(claimed,0);
});
test('Node HTTP ingress denies unsupported route and invalid deadline',async()=>{
 let claimed=0;
 for(const [method,path,deadline] of [
  ['GET','/v1/send',100],['POST','/v1/send?x=1',100],
  ['POST','/v1/send',0],['POST','/v1/send',30_001],
 ] as const){
  const req=incoming(Buffer.from('body'),['Content-Length','4']);
  req.method=method;req.url=path;
  await assert.rejects(dispatchOtpNodeIncomingMessage(req,config,
   ledger(()=>{claimed++;}),()=>{throw new Error('vendor constructed');},
   deadline),/otp_gateway_request_rejected/);
 }
 assert.equal(claimed,0);
});
