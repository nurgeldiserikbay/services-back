import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CancellationCommandRejected,parseCancellationCommand,
  parseCancellationIdempotencyHeader,parseCancellationRawJsonBody} from
  '../src/modules/requests/cancellation-command-contract.js';

const request='11111111-1111-4111-8111-111111111111';
const key='Cancel_2026_abcdef012345';

test('accepts one bounded version and opaque idempotency key only',()=>{
  const result=parseCancellationCommand(request,{expectedVersion:3},key);
  assert.deepEqual(result,{requestId:request,expectedVersion:3,
    idempotencyKey:key});
  assert.equal(Object.isFrozen(result),true);
  assert.equal(parseCancellationIdempotencyHeader(key),key);
});
test('rejects actor/seller/reliability overrides, malformed and replay-unsafe bodies',()=>{
  for(const body of [
    {},null,[],{expectedVersion:0},{expectedVersion:-1},
    {expectedVersion:1.2},{expectedVersion:'1'},
    {expectedVersion:1,actor:'SELLER'},
    {expectedVersion:1,customerPenaltySuspended:true},
    {expectedVersion:1,approvalId:'FAKE'},
    {expectedVersion:1,reliabilityWeight:0},
  ]){
    assert.throws(()=>parseCancellationCommand(request,body,key),
      CancellationCommandRejected);
  }
});
test('rejects missing, short, long, multi-valued and unsafe keys',()=>{
  for(const value of [undefined,null,[],['a','b'],'',
    'short','a'.repeat(129),'abc,def','contains spaces','a/b/c',
  ]){
    assert.throws(()=>parseCancellationIdempotencyHeader(value),
      CancellationCommandRejected);
    assert.throws(()=>parseCancellationCommand(
      request,{expectedVersion:1},value),CancellationCommandRejected);
  }
});
test('request must be a canonical UUID, no fallback from body',()=>{
  for(const value of [null,{},'', '1', '../request',request+'?x=1']){
    assert.throws(()=>parseCancellationCommand(
      value,{expectedVersion:1},key),CancellationCommandRejected);
  }
});

test('unmounted cancellation command rejects exotic prototypes and accessors',()=>{
  let getterCalled=false;
  const getter=Object.defineProperty({},'expectedVersion',{
    enumerable:true,configurable:true,get(){
      getterCalled=true;
      throw new Error('untrusted getter must not run');
    },
  });
  assert.throws(()=>parseCancellationCommand(request,getter,key),
    (error:unknown)=>error instanceof CancellationCommandRejected&&
      error.reason==='invalid_request');
  assert.equal(getterCalled,false);
  const inherited=Object.create({expectedVersion:1}) as Record<string,unknown>;
  assert.throws(()=>parseCancellationCommand(request,inherited,key),
    CancellationCommandRejected);
  class Body {expectedVersion=1;}
  assert.throws(()=>parseCancellationCommand(request,new Body(),key),
    CancellationCommandRejected);
  assert.throws(()=>parseCancellationCommand(request,new Date(),key),
    CancellationCommandRejected);
  const nullProto=Object.assign(Object.create(null) as Record<string,number>,
    {expectedVersion:1});
  assert.deepEqual(parseCancellationCommand(request,nullProto,key),{
    requestId:request,expectedVersion:1,idempotencyKey:key,
  });
});

test('raw cancellation JSON allows only one bounded positive integer version',()=>{
  for(const [raw,version] of [
    ['{"expectedVersion":1}',1],
    [' \t\r\n{ "expectedVersion" : 42 }\n',42],
    ['{"expectedVersion":9007199254740991}',Number.MAX_SAFE_INTEGER],
  ] as const){
    assert.deepEqual(parseCancellationRawJsonBody(request,raw,key),{
      requestId:request,expectedVersion:version,idempotencyKey:key,
    });
  }
});
test('raw cancellation JSON denies duplicate names and escaped property aliases',()=>{
  for(const raw of [
    '{"expectedVersion":1,"expectedVersion":2}',
    '{"expectedVersion":1,"actor":"CUSTOMER"}',
    '{"expectedVersion":1,"\\u0061ctor":"SELLER"}',
    '{"expectedVersion":1,"\\u0065xpectedVersion":2}',
    '{"\\u0065xpectedVersion":1}',
    '{"expectedVersion":1,}',
    '{"expectedVersion":1}{"expectedVersion":2}',
    '{"expectedVersion":1}garbage',
    '{"expectedVersion":1}\\nnull',
    '[{"expectedVersion":1}]',
    '{"expectedVersion":true}',
    '{"expectedVersion":"1"}',
    '{"expectedVersion":1.0}',
    '{"expectedVersion":1e2}',
    '{"expectedVersion":01}',
    '{"expectedVersion":-1}',
    '{"expectedVersion":0}',
    '{"expectedVersion":9007199254740992}',
    '{"expectedVersion":999999999999999999999999999999}',
    '{"expectedVersion":1}\\u00a0',
    ' \\u00a0{"expectedVersion":1}',
    '{"expectedVersion":1}'.padEnd(129,' '),
  ]){
    assert.throws(()=>parseCancellationRawJsonBody(request,raw,key),
      CancellationCommandRejected,raw);
  }
  for(const input of [null,[],{},1,new Uint8Array([123]),undefined]){
    assert.throws(()=>parseCancellationRawJsonBody(request,input,key),
      CancellationCommandRejected);
  }
});
test('wire parser rejects invalid idempotency header and malformed request ID',()=>{
  assert.throws(()=>parseCancellationRawJsonBody(
    request,'{"expectedVersion":1}', 'bad'),CancellationCommandRejected);
  assert.throws(()=>parseCancellationRawJsonBody(
    '../invalid','{"expectedVersion":1}',key),CancellationCommandRejected);
});
