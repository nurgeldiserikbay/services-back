import assert from 'node:assert/strict';
import {test} from 'node:test';
import {otpNodeRawHeaderPairs} from
 '../src/platform/ingress/otp-gateway-node-rawheaders.reference.js';
import {OtpGatewayLedgerDispatchReference} from
 '../src/platform/ingress/otp-gateway-ledger-dispatch.reference.js';
import {dispatchBoundedOtpGatewayHttpStream} from
 '../src/platform/ingress/otp-gateway-stream-dispatch.reference.js';

const config={apiToken:'fixture'.repeat(8),idempotencySecret:Buffer.alloc(32,42)};
const base=[
 'Host','otp.private.example',
 'Authorization','Bearer '+'a'.repeat(48),
 'Idempotency-Key','a'.repeat(64),
 'X-Services-OTP-Payload-Fingerprint','b'.repeat(64),
 'Content-Type','application/json',
 'Content-Length','10',
];

test('Node OTP raw-header pairs retain original case, order and duplicates',()=>{
 const raw=[...base,'authorization','Bearer '+'b'.repeat(48)];
 const pairs=otpNodeRawHeaderPairs(raw);
 assert.equal(pairs.length,7);
 assert.deepEqual(pairs[1],['Authorization','Bearer '+'a'.repeat(48)]);
 assert.deepEqual(pairs[6],['authorization','Bearer '+'b'.repeat(48)]);
});

test('Node OTP raw-header pairs fail closed on truncation and malformed values',()=>{
 for(const raw of [
  [],['Authorization'],[...base,'Odd'],
  [...base,'x-extra','bad'+String.fromCharCode(10)+'line'],
  [...base,'x-extra','bad'+String.fromCharCode(13)+'line'],
  [...base,'bad name','v'],
  [...base,'x-extra','v'.repeat(1025)],
  [...base,...Array.from({length:60},(_,i)=>i%2===0?'x-custom':'v')],
 ]){
  assert.throws(()=>otpNodeRawHeaderPairs(raw),
   /otp_gateway_request_rejected/);
 }
});

test('Node original duplicate Authorization denies before OTP body consumption',async()=>{
 let consumed=0;
 let claimed=0;
 const gateway=new OtpGatewayLedgerDispatchReference({
  claim:async()=>{claimed++;return {decision:'send' as const};},
  recordAccepted:async()=>true,
 });
 const raw=[...base,'authorization','Bearer '+'b'.repeat(48)];
 async function* stream(){consumed++;yield Buffer.from('irrelevant');}
 await assert.rejects(dispatchBoundedOtpGatewayHttpStream(
  'POST','/v1/send',otpNodeRawHeaderPairs(raw),stream(),
  config,gateway,()=>{throw new Error('vendor must not be called');},
 ),/otp_gateway_request_rejected/);
 assert.equal(consumed,0);
 assert.equal(claimed,0);
});
