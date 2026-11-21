import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import type {ServerResponse,IncomingMessage} from 'node:http';
import {Readable} from 'node:stream';
import {test} from 'node:test';
import {
  createOtpGatewayReferenceHttpHandler,
} from '../src/platform/ingress/otp-gateway-http-handler.reference.js';
import {OtpGatewayLedgerDispatchReference} from
 '../src/platform/ingress/otp-gateway-ledger-dispatch.reference.js';

const config={apiToken:'fixture'.repeat(8),idempotencySecret:Buffer.alloc(32,42)};
const key='a'.repeat(64);
const payload={
 channel:'email',destination:'person@example.org',code:'123456',
 purpose:'CREATE_REQUEST',locale:'kk',expiresInSeconds:600,
};
const raw=JSON.stringify(payload);
const fingerprint=createHmac('sha256',config.idempotencySecret)
 .update('services-guest-otp-payload:v1\n')
 .update(key).update('\n').update(raw).digest('hex');

function incoming(overrides?:{route?:string;badSignature?:boolean}):IncomingMessage{
 const request=Readable.from([Buffer.from(raw)]) as IncomingMessage;
 Object.assign(request,{
  method:'POST',url:overrides?.route??'/v1/send',
  aborted:false,complete:true,
  rawHeaders:[
   'Authorization','Bearer '+config.apiToken,
   'Idempotency-Key',key,
   'X-Services-OTP-Payload-Fingerprint',
      overrides?.badSignature?'b'.repeat(64):fingerprint,
   'Content-Type','application/json',
   'Content-Length',String(Buffer.byteLength(raw)),
  ],
 });
 return request;
}
function response(){
 const captured:{status?:number;headers?:Record<string,string>;body?:string}={};
 const fake={
  destroyed:false,headersSent:false,writableEnded:false,
  writeHead(status:number,headers:Record<string,string>){
   captured.status=status;captured.headers=headers;
   this.headersSent=true;return this;
  },
  end(body?:string){captured.body=body;this.writableEnded=true;return this;},
  destroy(){this.destroyed=true;return this;},
 };
 return {captured,res:fake as unknown as ServerResponse};
}
function ledger(decision:'send'|'in_flight'|'conflict',onClaim:()=>void){
 return new OtpGatewayLedgerDispatchReference({
  claim:async()=>{onClaim();return {decision};},
  recordAccepted:async()=>true,
 });
}

test('OTP reference HTTP handler returns 202 JSON only on durable accepted send',async()=>{
 let claimed=0,delivered=0;
 const {res,captured}=response();
 await createOtpGatewayReferenceHttpHandler(
  config,ledger('send',()=>claimed++),payload=>({
   sendOnce:async()=>{
    delivered++;
    assert.equal(payload.code,'123456');
    return {accepted:true,providerRef:'provider_12345678'};
   },
  }),
 )(incoming(),res);
 assert.equal(claimed,1);
 assert.equal(delivered,1);
 assert.equal(captured.status,202);
 assert.deepEqual(JSON.parse(captured.body??''),{
  accepted:true,providerRef:'provider_12345678',
 });
 assert.equal(captured.headers?.['cache-control'],'no-store');
 assert.equal(captured.headers?.['x-content-type-options'],'nosniff');
 assert.equal(captured.headers?.['content-length'],
  String(Buffer.byteLength(captured.body??'')));
});

test('OTP HTTP handler returns 409 for in-flight/conflict without vendor call',async()=>{
 for(const state of ['in_flight','conflict'] as const){
  let claimed=0,constructed=0;
  const {res,captured}=response();
  await createOtpGatewayReferenceHttpHandler(
   config,ledger(state,()=>claimed++),()=>{
    constructed++;
    return {sendOnce:async()=>{throw new Error('unexpected');}};
   },
  )(incoming(),res);
  assert.equal(claimed,1);
  // Verified payload may construct the port; it must never send.
  assert.equal(constructed,1);
  assert.equal(captured.status,409);
  assert.equal(captured.body,'{"accepted":false}');
 }
});

test('OTP HTTP handler denies invalid signature and wrong route before ledger',async()=>{
 let claimed=0,constructed=0;
 const handler=createOtpGatewayReferenceHttpHandler(
  config,ledger('send',()=>claimed++),()=>{
   constructed++;
   return {sendOnce:async()=>{throw new Error('unexpected');}};
  },
 );
 const invalid=response();
 await handler(incoming({badSignature:true}),invalid.res);
 assert.equal(invalid.captured.status,503);
 assert.equal(invalid.captured.body,'{"accepted":false}');
 const wrong=response();
 await handler(incoming({route:'/v1/send?unexpected=true'}),wrong.res);
 assert.equal(wrong.captured.status,404);
 assert.equal(wrong.captured.body,'{"accepted":false}');
 assert.equal(claimed,0);
 assert.equal(constructed,0);
});

test('OTP HTTP handler rejects invalid deadline before request processing',()=>{
 assert.throws(()=>createOtpGatewayReferenceHttpHandler(
  config,ledger('send',()=>{}),()=>({
   sendOnce:async()=>({accepted:true as const,providerRef:'ok'}),
  }),0),/otp_gateway_request_rejected/);
});
