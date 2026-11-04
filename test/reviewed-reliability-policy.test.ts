import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateReviewedReliabilityPolicy,ReliabilityPolicyUnavailable}
  from '../src/modules/requests/reviewed-reliability-policy.js';

const valid={formulaVersion:'reviewed_v1',lateCustomerWeight:'1.25',
  approvalId:'APPROVAL-2026-001'};

test('no default, explicit reviewed positive bounded reliability policy only',()=>{
  assert.deepEqual(validateReviewedReliabilityPolicy(valid),valid);
  for(const candidate of [
    undefined,null,{},[],{...valid,lateCustomerWeight:0},
    {...valid,lateCustomerWeight:'0'},
    {...valid,lateCustomerWeight:'-1'},
    {...valid,lateCustomerWeight:'1000'},
    {...valid,lateCustomerWeight:'1.234'},
    {...valid,lateCustomerWeight:'Infinity'},
    {...valid,formulaVersion:'x'.repeat(33)},
    {...valid,approvalId:'unreviewed'},
    {...valid,approvalId:''},
    {...valid,extra:true},
  ])assert.throws(()=>validateReviewedReliabilityPolicy(candidate),
    ReliabilityPolicyUnavailable);
});
