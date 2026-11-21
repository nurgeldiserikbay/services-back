import assert from 'node:assert/strict';
import {test} from 'node:test';
import {Readable} from 'node:stream';
import type {IncomingMessage} from 'node:http';
import {TLSSocket} from 'node:tls';
import {
  dispatchMtlsOtpNodeIncomingMessage,
  verifyOtpNodeMtlsPeer,
} from '../src/platform/ingress/otp-gateway-node-mtls.reference.js';
import {OtpGatewayLedgerDispatchReference} from
 '../src/platform/ingress/otp-gateway-ledger-dispatch.reference.js';

const pin='ab'.repeat(32);
const config={apiToken:'fixture'.repeat(8),idempotencySecret:Buffer.alloc(32,42)};

/** TLS properties are simulated at the boundary; no certificate is issued. */
function requestWithTlsPeer(opts?:{
 authorized?:boolean;encrypted?:boolean;fingerprint?:string|null;
 authorizationError?:Error|null;
}):IncomingMessage{
 const request=Readable.from([Buffer.from('x')]) as IncomingMessage;
 Object.assign(request,{
  method:'POST',url:'/v1/send',complete:true,aborted:false,
  rawHeaders:['Content-Length','1'],
 });
 const fake=Object.create(TLSSocket.prototype) as TLSSocket;
 Object.defineProperties(fake,{
  encrypted:{value:opts?.encrypted??true,configurable:true},
  authorized:{value:opts?.authorized??true,configurable:true},
  authorizationError:{value:opts?.authorizationError??null,configurable:true},
  getPeerCertificate:{value:()=>opts?.fingerprint===null?{}:{
   fingerprint256:opts?.fingerprint??pin.toUpperCase().match(/.{2}/g)!.join(':'),
  }},
 });
 Object.defineProperty(request,'socket',{value:fake,configurable:true});
 return request;
}

test('Node OTP mTLS gate accepts authorized TLS certificate matching the approved pin',()=>{
 assert.doesNotThrow(()=>verifyOtpNodeMtlsPeer(requestWithTlsPeer(),pin));
});

test('Node OTP mTLS gate denies an untrusted peer, invalid pin and absent cert',()=>{
 const cases=[
  requestWithTlsPeer({authorized:false}),
  requestWithTlsPeer({encrypted:false}),
  requestWithTlsPeer({authorizationError:new Error('certificate rejected')}),
  requestWithTlsPeer({fingerprint:null}),
  requestWithTlsPeer({fingerprint:'CD:'.repeat(31)+'CD'}),
  requestWithTlsPeer({fingerprint:'abc'}),
  Readable.from([Buffer.from('x')]) as IncomingMessage,
 ];
 for(const request of cases){
  assert.throws(()=>verifyOtpNodeMtlsPeer(request,pin),
   /otp_gateway_request_rejected/);
 }
 for(const badPin of ['',pin.toUpperCase(),'ab'.repeat(31),'z'.repeat(64)]){
  assert.throws(()=>verifyOtpNodeMtlsPeer(requestWithTlsPeer(),badPin),
   /otp_gateway_request_rejected/);
 }
});

test('mTLS entrypoint denies wrong peer before reading body or claiming ledger',async()=>{
 let consumed=0;
 let claimed=0;
 const request=new Readable({read(){consumed++;this.push(Buffer.from('x'));this.push(null);}})
  as IncomingMessage;
 Object.assign(request,{
  method:'POST',url:'/v1/send',complete:false,aborted:false,
  rawHeaders:['Content-Length','1'],
 });
 const fake=Object.create(TLSSocket.prototype) as TLSSocket;
 Object.defineProperties(fake,{
  encrypted:{value:true},authorized:{value:false},authorizationError:{value:null},
  getPeerCertificate:{value:()=>({fingerprint256:pin.toUpperCase().match(/.{2}/g)!.join(':')})},
 });
 Object.defineProperty(request,'socket',{value:fake});
 const gateway=new OtpGatewayLedgerDispatchReference({
  claim:async()=>{claimed++;return {decision:'send' as const};},
  recordAccepted:async()=>true,
 });
 await assert.rejects(dispatchMtlsOtpNodeIncomingMessage(
  request,pin,config,gateway,()=>{throw new Error('unexpected vendor');},
 ),/otp_gateway_request_rejected/);
 assert.equal(consumed,0);
 assert.equal(claimed,0);
});
