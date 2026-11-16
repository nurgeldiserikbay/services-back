import {test} from 'node:test';
import assert from 'node:assert/strict';
import {evaluateExternalDeliveryQueueAlerts}
 from '../src/modules/notifications/external-delivery-alerts.js';
import type {ExternalDeliveryQueueSnapshot}
 from '../src/modules/notifications/external-delivery-monitoring.js';

const policy={pendingDueThreshold:10,expiredLeaseThreshold:2,terminalFailedThreshold:3};
const empty:ExternalDeliveryQueueSnapshot={
 pendingDue:0,pendingScheduled:0,leasedActive:0,leasedExpired:0,
 terminalFailed:0,providerAccepted:0,inconsistent:0,total:0,
};

function snapshot(patch:Partial<ExternalDeliveryQueueSnapshot>){
 const value={...empty,...patch};
 return {...value,total:value.pendingDue+value.pendingScheduled+
  value.leasedActive+value.leasedExpired+value.terminalFailed+
  value.providerAccepted+value.inconsistent};
}

test('alert evaluator has no default thresholds and empty snapshot is quiet',()=>{
 assert.deepEqual(evaluateExternalDeliveryQueueAlerts(empty,policy),[]);
});

test('alert evaluator emits deterministic aggregate-only alerts at configured thresholds',()=>{
 const value=snapshot({
  pendingDue:10,leasedExpired:2,terminalFailed:3,inconsistent:1,
 });
 const alerts=evaluateExternalDeliveryQueueAlerts(value,policy);
 assert.deepEqual(alerts,[
  {code:'QUEUE_INCONSISTENT',severity:'critical',observed:1,threshold:1},
  {code:'EXPIRED_LEASES',severity:'warning',observed:2,threshold:2},
  {code:'TERMINAL_FAILURES',severity:'warning',observed:3,threshold:3},
  {code:'DUE_BACKLOG',severity:'warning',observed:10,threshold:10},
 ]);
 const serialized=JSON.stringify(alerts);
 assert.equal(serialized.includes('intentId'),false);
 assert.equal(serialized.includes('recipient'),false);
 assert.equal(serialized.includes('provider'),false);
 assert.deepEqual(evaluateExternalDeliveryQueueAlerts(
  snapshot({pendingDue:9,leasedExpired:1,terminalFailed:2}),policy),[]);
});

test('invalid counts and mismatched totals never produce a healthy outcome',()=>{
 for(const value of [
  {...empty,total:1},{...empty,total:-1},
  {...empty,pendingDue:-1},{...empty,pendingDue:NaN},
  {...empty,leasedActive:Infinity},
  {...empty,providerAccepted:9007199254740992},
  {...empty,pendingScheduled:1.5},
 ]){
  assert.throws(()=>evaluateExternalDeliveryQueueAlerts(
   value as ExternalDeliveryQueueSnapshot,policy),
  /invalid_external_delivery_alert_snapshot/);
 }
});

test('no implicit SLO: unsafe thresholds fail closed',()=>{
 for(const invalid of [0,-1,1.2,NaN,Infinity,9007199254740992]){
  for(const key of ['pendingDueThreshold','expiredLeaseThreshold',
    'terminalFailedThreshold'] as const){
   assert.throws(()=>evaluateExternalDeliveryQueueAlerts(empty,{
    ...policy,[key]:invalid,
   }),/invalid_external_delivery_alert_policy/);
  }
 }
 assert.throws(()=>evaluateExternalDeliveryQueueAlerts(empty,null as never),
  /invalid_external_delivery_alert_input/);
});


test('rejects inherited and getter-backed metrics without executing getters',()=>{
 let reads=0;
 const getterValue={...empty};
 Object.defineProperty(getterValue,'pendingDue',{
  enumerable:true,get(){reads++;throw new Error('should not execute getter');},
 });
 assert.throws(()=>evaluateExternalDeliveryQueueAlerts(
  getterValue as ExternalDeliveryQueueSnapshot,policy),
 /invalid_external_delivery_alert_input/);
 assert.equal(reads,0);

 const inherited=Object.create({pendingDue:0}) as Record<string,unknown>;
 Object.assign(inherited,empty);
 delete inherited.pendingDue;
 assert.throws(()=>evaluateExternalDeliveryQueueAlerts(
  inherited as unknown as ExternalDeliveryQueueSnapshot,policy),
 /invalid_external_delivery_alert_input/);

 const getterPolicy={...policy};
 Object.defineProperty(getterPolicy,'expiredLeaseThreshold',{
  get(){reads++;throw new Error('should not execute policy getter');},
 });
 assert.throws(()=>evaluateExternalDeliveryQueueAlerts(
  empty,getterPolicy),
 /invalid_external_delivery_alert_input/);
 assert.equal(reads,0);

 const inheritedPolicy=Object.create({pendingDueThreshold:10}) as Record<string,unknown>;
 Object.assign(inheritedPolicy,{expiredLeaseThreshold:2,terminalFailedThreshold:3});
 assert.throws(()=>evaluateExternalDeliveryQueueAlerts(
  empty,inheritedPolicy as unknown as typeof policy),
 /invalid_external_delivery_alert_input/);
});
