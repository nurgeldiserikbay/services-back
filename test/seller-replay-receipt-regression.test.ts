import assert from 'node:assert/strict';
import {test} from 'node:test';
import {validateStoredReply} from '../src/modules/requests/seller-decision-idempotent.js';
import {SellerDecisionRejected} from '../src/modules/requests/seller-decision.transaction.js';

const requestId='11111111-1111-4111-8111-111111111111';
const valid={id:requestId,state:'accepted',version:2,replayed:false};

test('stored receipt replay marks matching committed result as replayed',()=>{
  assert.deepEqual(validateStoredReply(valid,requestId,'accept',1),{
    ...valid,replayed:true,
  });
});

test('stored receipt rejects wrong request, decision, version and replay marker',()=>{
  for(const receipt of [
    {...valid,id:'22222222-2222-4222-8222-222222222222'},
    {...valid,state:'declined'},
    {...valid,version:3},
    {...valid,version:1},
    {...valid,replayed:true},
    {...valid,version:1.5},
    null,
    [],
  ]){
    assert.throws(()=>validateStoredReply(receipt,requestId,'accept',1),
      (error:unknown)=>error instanceof SellerDecisionRejected&&error.reason==='conflict');
  }
});
