import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {
  computeEffectiveCancellationDeadline,
  evaluateCancellationReliability,
  ReliabilityPolicyUnavailable,
  RELIABILITY_POLICY_VERSION,
  type ReliabilityContext,
} from '../src/modules/requests/cancellation-reliability-v1.js';

const customer=randomUUID(),professional=randomUUID(),organization=randomUUID();
const at=(time:string)=>new Date('2026-11-09T'+time+'Z');
const start=at('12:00:00'),accepted=at('11:30:00');
const confirmed=at('11:30:00');
const schedule={
  startAt:start,acceptedAt:accepted,confirmedAt:confirmed,
  freeCancelBeforeMin:120,effectiveDeadline:at('11:45:00'),
};
const context=(overrides:Partial<ReliabilityContext>={}):ReliabilityContext=>({
  state:'ACCEPTED',actor:'customer',now:at('11:46:00'),
  customerPersonId:customer,sellerProfessionalId:professional,
  sellerOrganizationId:null,customerPenaltySuspended:false,schedule,
  ...overrides,
});

test('CAN-T13: late confirmation gives 15-minute grace capped by start',()=>{
  const deadline=computeEffectiveCancellationDeadline({
    startAt:start,acceptedAt:accepted,confirmedAt:confirmed,
    freeCancelBeforeMin:120,
  });
  assert.equal(deadline?.toISOString(),at('11:45:00').toISOString());
  assert.equal(computeEffectiveCancellationDeadline({
    startAt:start,acceptedAt:at('11:55:00'),
    confirmedAt:at('11:55:00'),freeCancelBeforeMin:120,
  })?.getTime(),start.getTime());
  assert.equal(computeEffectiveCancellationDeadline({
    startAt:start,acceptedAt:start,confirmedAt:start,
    freeCancelBeforeMin:120,
  }),null);
});
test('confirmed agreement after request acceptance sets grace by confirmation',()=>{
  assert.equal(computeEffectiveCancellationDeadline({
    startAt:start,acceptedAt:at('09:00:00'),
    confirmedAt:at('11:30:00'),freeCancelBeforeMin:120,
  })?.getTime(),at('11:45:00').getTime());
  assert.equal(computeEffectiveCancellationDeadline({
    startAt:start,acceptedAt:at('08:00:00'),
    confirmedAt:at('09:00:00'),freeCancelBeforeMin:120,
  })?.getTime(),at('10:00:00').getTime());
});
test('customer deadline equality is free and one millisecond later is eligible',()=>{
  assert.equal(evaluateCancellationReliability(context({
    now:at('11:45:00'),
  })).proposal,null);
  assert.equal(evaluateCancellationReliability(context({
    now:new Date(at('11:45:00').getTime()+1),
  })).proposal?.weight,'1.00');
  const d=evaluateCancellationReliability(context());
  assert.equal(d.reason,'eligible_customer');
  assert.equal(d.late,true);
  assert.deepEqual(d.proposal,{
    subject:'CUSTOMER',targetId:customer,
    reason:'LATE_CUSTOMER_CANCELLATION',weight:'1.00',
    formulaVersion:RELIABILITY_POLICY_VERSION,
  });
});
test('no negative client event without exact immutable confirmed terms',()=>{
  const cases:Partial<ReliabilityContext>[]=[
    {state:'PENDING'}, {customerPersonId:null},
    {customerPenaltySuspended:true},
    {schedule:null},
    {schedule:{...schedule,confirmedAt:null}},
    {schedule:{...schedule,effectiveDeadline:null}},
    {schedule:{...schedule,effectiveDeadline:at('10:00:00')}},
    {now:at('12:00:00')},
    {now:at('12:01:00')},
  ];
  for(const change of cases){
    const result=evaluateCancellationReliability(context(change));
    assert.equal(result.proposal,null,JSON.stringify(change));
  }
});
test('provider event points to original seller and applies 24h weights',()=>{
  const earlyStart=new Date(Date.now()+48*3600000);
  const earlyTime=new Date(earlyStart.getTime()-25*3600000);
  const early=evaluateCancellationReliability(context({
    actor:'provider',now:earlyTime,
    schedule:{...schedule,startAt:earlyStart,confirmedAt:earlyTime,
      acceptedAt:earlyTime,effectiveDeadline:new Date(earlyStart.getTime()-7200000)},
  }));
  assert.deepEqual(early.proposal,{
    subject:'PROFESSIONAL',targetId:professional,
    reason:'PROVIDER_CANCELLATION',weight:'0.50',
    formulaVersion:RELIABILITY_POLICY_VERSION,
  });
  const late=evaluateCancellationReliability(context({
    actor:'provider',now:at('11:46:00'),
    sellerProfessionalId:null,sellerOrganizationId:organization,
  }));
  assert.equal(late.proposal?.weight,'1.00');
  assert.equal(late.proposal?.subject,'ORGANIZATION');
  assert.equal(late.proposal?.targetId,organization);
  const noTime=evaluateCancellationReliability(context({
    actor:'provider',schedule:null,
  }));
  assert.equal(noTime.proposal?.weight,'0.50');
});
test('invalid seller identities, dates and seller policy are rejected',()=>{
  for(const invalid of [
    {sellerProfessionalId:null,sellerOrganizationId:null},
    {sellerProfessionalId:professional,sellerOrganizationId:organization},
    {sellerProfessionalId:'invalid'},
    {now:new Date('invalid')},
    {schedule:{...schedule,freeCancelBeforeMin:-1}},
    {schedule:{...schedule,freeCancelBeforeMin:10081}},
  ])assert.throws(()=>evaluateCancellationReliability(context(
    invalid as Partial<ReliabilityContext>,
  )),ReliabilityPolicyUnavailable);
});

test('customer-only penalty suspension never excuses a provider cancellation',()=>{
  const provider=evaluateCancellationReliability(context({
    actor:'provider',customerPenaltySuspended:true,
  }));
  assert.equal(provider.reason,'eligible_provider');
  assert.equal(provider.proposal?.subject,'PROFESSIONAL');
  assert.equal(provider.proposal?.weight,'1.00');
  const customerDecision=evaluateCancellationReliability(context({
    actor:'customer',customerPenaltySuspended:true,
  }));
  assert.equal(customerDecision.proposal,null);
  assert.equal(customerDecision.reason,'suspended');
});
