import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CancellationCommandRejected,parseCancellationCommand,
  parseCancellationIdempotencyHeader} from
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
