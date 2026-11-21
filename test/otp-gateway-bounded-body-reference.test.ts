import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readBoundedOtpGatewayBody} from
 '../src/platform/ingress/otp-gateway-bounded-body.reference.js';

async function* chunks(...values:Buffer[]){
 for(const value of values)yield value;
}

test('OTP gateway stream accepts bounded bytes without changing them',async()=>{
 const expected=Buffer.from('{"purpose":"CREATE_REQUEST"}','utf8');
 const body=await readBoundedOtpGatewayBody(chunks(
  expected.subarray(0,5),expected.subarray(5),
 ));
 assert.deepEqual(body,expected);
 assert.equal((await readBoundedOtpGatewayBody(chunks(Buffer.alloc(1024)))).length,1024);
});

test('OTP gateway stream rejects empty, non-buffer and oversized input',async()=>{
 await assert.rejects(readBoundedOtpGatewayBody(chunks()),/otp_gateway_request_rejected/);
 await assert.rejects(readBoundedOtpGatewayBody(chunks(Buffer.alloc(1025))),
  /otp_gateway_request_rejected/);
 await assert.rejects(readBoundedOtpGatewayBody(chunks(Buffer.alloc(1024),Buffer.from('a'))),
  /otp_gateway_request_rejected/);
 async function* invalid(){yield 'not bytes' as unknown as Buffer;}
 await assert.rejects(readBoundedOtpGatewayBody(invalid()),/otp_gateway_request_rejected/);
});

test('OTP gateway stream stops reading after oversized chunk',async()=>{
 let readCount=0;
 let finalized=false;
 async function* adversarial(){
  try{
   readCount++;yield Buffer.alloc(1023);
   readCount++;yield Buffer.alloc(2);
   readCount++;yield Buffer.from('should not consume');
  }finally{finalized=true;}
 }
 await assert.rejects(readBoundedOtpGatewayBody(adversarial()),
  /otp_gateway_request_rejected/);
 assert.equal(readCount,2);
 assert.equal(finalized,true);
});

test('OTP gateway stream denies aborted requests',async()=>{
 const signal=new AbortController();
 signal.abort();
 let consumed=false;
 async function* neverRead(){consumed=true;yield Buffer.from('a');}
 await assert.rejects(readBoundedOtpGatewayBody(neverRead(),signal.signal),
  /otp_gateway_request_rejected/);
 assert.equal(consumed,false);
 const midway=new AbortController();
 async function* abortAfterFirst(){
  yield Buffer.from('a');
  midway.abort();
  yield Buffer.from('b');
 }
 await assert.rejects(readBoundedOtpGatewayBody(abortAfterFirst(),midway.signal),
  /otp_gateway_request_rejected/);
});

test('OTP gateway abort interrupts stalled next and never awaits stalled return',async()=>{
 const controller=new AbortController();
 let entered=0;
 let cleanupCalled=0;
 const source:AsyncIterable<Buffer>={
  [Symbol.asyncIterator](){
   return {
    next:()=>{
     entered++;
     controller.abort();
     return new Promise<IteratorResult<Buffer>>(()=>{});
    },
    return:()=>{
     cleanupCalled++;
     return new Promise<IteratorResult<Buffer>>(()=>{});
    },
   };
  },
 };
 await assert.rejects(readBoundedOtpGatewayBody(source,controller.signal),
  /otp_gateway_request_rejected/);
 assert.equal(entered,1);
 // Iterator shutdown is best-effort and must not block the rejection.
 await Promise.resolve();
 assert.equal(cleanupCalled,1);
});

test('OTP gateway rejects a stalled iterator after an external abort',async()=>{
 const controller=new AbortController();
 let entered!:()=>void;
 const started=new Promise<void>(resolve=>{entered=resolve;});
 const source:AsyncIterable<Buffer>={
  [Symbol.asyncIterator](){
   return {
    next:()=>{
     entered();
     return new Promise<IteratorResult<Buffer>>(()=>{});
    },
   };
  },
 };
 const result=readBoundedOtpGatewayBody(source,controller.signal);
 await started;
 controller.abort();
 await assert.rejects(result,/otp_gateway_request_rejected/);
});
