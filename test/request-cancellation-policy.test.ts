import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {
  classifyRequestCancellation,CancellationPolicyRejected,
  type CancellationContext,
} from '../src/modules/requests/request-cancellation-policy.js';

const customer=randomUUID(),professional=randomUUID(),organization=randomUUID();
const cutoff=new Date('2026-11-05T10:00:00Z');
const scheduled=new Date('2026-11-05T12:00:00Z');
const snapshot={
  acceptedAt:new Date('2026-11-04T08:00:00Z'),
  scheduledStartAt:scheduled,freeCancelUntil:cutoff,
  policyRevision:3,timezone:'Asia/Almaty',
};
function context(override:Partial<CancellationContext>={}):CancellationContext{
  return {
    state:'ACCEPTED',actor:'customer',now:new Date('2026-11-05T09:59:00Z'),
    customerPersonId:customer,sellerProfessionalId:professional,
    sellerOrganizationId:null,snapshot,customerPenaltySuspended:false,
    scheduleReconciliationRequired:false,...override,
  };
}
test('every allowed cancellation requires initiator and counterparty notification',()=>{
  for(const actor of ['customer','provider'] as const){
    for(const state of ['PENDING','ACCEPTED'] as const){
      const result=classifyRequestCancellation(context({actor,state}));
      assert.deepEqual(result.requiredAudiences,['INITIATOR','COUNTERPARTY']);
      assert.equal(result.actor,actor==='customer'?'CUSTOMER':'SELLER');
      assert.equal(result.nextState,
        actor==='customer'?'CANCELLED_BY_CUSTOMER':'CANCELLED_BY_PROVIDER');
    }
  }
});
test('pending request cannot assign late penalty or provider penalty',()=>{
  for(const actor of ['customer','provider'] as const){
    const result=classifyRequestCancellation(context({
      state:'PENDING',actor,snapshot:null,
    }));
    assert.equal(result.isLate,false);
    assert.equal(result.reliability,null);
  }
});
test('deadline is inclusive: customer late only strictly after snapshot cutoff',()=>{
  for(const now of [new Date(cutoff.getTime()-1),cutoff]){
    const result=classifyRequestCancellation(context({now}));
    assert.equal(result.isLate,false);
    assert.equal(result.reliability,null);
  }
  const late=classifyRequestCancellation(context({
    now:new Date(cutoff.getTime()+1),
  }));
  assert.equal(late.isLate,true);
  assert.deepEqual(late.reliability,{
    subject:'CUSTOMER',targetId:customer,reason:'LATE_CUSTOMER_CANCELLATION',
  });
});
test('guest, suspension or missing confirmed snapshot prevent a customer penalty',()=>{
  for(const input of [
    {customerPersonId:null},
    {customerPenaltySuspended:true},
    {snapshot:null},
  ]){
    const result=classifyRequestCancellation(context({
      now:new Date('2026-11-06T13:00:00Z'),...input,
    }));
    assert.equal(result.reliability,null);
    if(input.snapshot===null)assert.equal(result.isLate,false);
  }
});
test('accepted provider cancellation attaches liability to seller, not employee',()=>{
  const professionalResult=classifyRequestCancellation(context({
    actor:'provider',
  }));
  assert.deepEqual(professionalResult.reliability,{
    subject:'PROFESSIONAL',targetId:professional,reason:'PROVIDER_CANCELLATION',
  });
  const companyResult=classifyRequestCancellation(context({
    actor:'provider',sellerProfessionalId:null,sellerOrganizationId:organization,
  }));
  assert.deepEqual(companyResult.reliability,{
    subject:'ORGANIZATION',targetId:organization,reason:'PROVIDER_CANCELLATION',
  });
  assert.equal(companyResult.isLate,false);
});
test('terminal states, pending reconciliation and ambiguous seller identities fail closed',()=>{
  for(const state of ['DECLINED','COMPLETED','EXPIRED',
    'CANCELLED_BY_CUSTOMER','CANCELLED_BY_PROVIDER','CANCELLED_MUTUAL'] as const){
    assert.throws(()=>classifyRequestCancellation(context({state})),
      (error:unknown)=>error instanceof CancellationPolicyRejected&&
        error.reason==='conflict');
  }
  assert.throws(()=>classifyRequestCancellation(context({
    scheduleReconciliationRequired:true,
  })),CancellationPolicyRejected);
  for(const input of [
    {sellerProfessionalId:null,sellerOrganizationId:null},
    {sellerProfessionalId:professional,sellerOrganizationId:organization},
    {sellerProfessionalId:'not-a-uuid'},
    {now:new Date('invalid')},
    {snapshot:{...snapshot,freeCancelUntil:new Date('invalid')}},
    {snapshot:{...snapshot,policyRevision:0}},
    {snapshot:{...snapshot,freeCancelUntil:new Date('2026-11-05T13:00:00Z')}},
  ]){
    assert.throws(()=>classifyRequestCancellation(context(
      input as Partial<CancellationContext>,
    )),CancellationPolicyRejected);
  }
});
