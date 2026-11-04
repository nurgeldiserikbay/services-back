import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
  validateReviewedProviderReliability,AcceptedProviderCancellationRejected,
  cancelAcceptedByVerifiedProviderOwner,
} from '../src/modules/requests/accepted-provider-cancellation.transaction.js';

const id='11111111-1111-4111-8111-111111111111';
const person='22222222-2222-4222-8222-222222222222';
const policy={formulaVersion:'reviewed_v1',approvalId:'APPROVAL-2026-001',
  providerWeight:'0.50'};

test('no provider reliability formula default or unapproved weight',()=>{
  assert.deepEqual(validateReviewedProviderReliability(policy),policy);
  for(const v of [null,{},[],{...policy,providerWeight:'0'},
    {...policy,providerWeight:'-1'},{...policy,providerWeight:'100'},
    {...policy,providerWeight:'1.234'},
    {...policy,approvalId:'invalid'}, {...policy,other:'x'}]){
    assert.throws(()=>validateReviewedProviderReliability(v),
      AcceptedProviderCancellationRejected);
  }
});
test('invalid input and missing policy do not touch the database',async()=>{
  const db={query:async()=>{throw Error('db touched');}};
  for(const [r,p,v] of [['invalid',person,1],[id,'bad',1],[id,person,0]] as const){
    await assert.rejects(cancelAcceptedByVerifiedProviderOwner(db as never,
      r,p,v,policy),AcceptedProviderCancellationRejected);
  }
  await assert.rejects(cancelAcceptedByVerifiedProviderOwner(db as never,
    id,person,1,null as never),AcceptedProviderCancellationRejected);
});
test('terminal or stale requests fail before any cancellation write',async()=>{
  const statements:string[]=[];
  const db={query:async(sql:string)=>{
    statements.push(sql);
    return {rows:[{status:'COMPLETED',version:2}]};
  }};
  await assert.rejects(cancelAcceptedByVerifiedProviderOwner(db as never,
    id,person,1,policy),AcceptedProviderCancellationRejected);
  assert.equal(statements.length,1);
});
