import {test} from 'node:test';
import assert from 'node:assert/strict';
import {decideExternalAlertReceiverRetry}
 from '../src/modules/notifications/external-delivery-alert-receiver-retry-policy.js';

const policy={baseDelayMs:1000,maxDelayMs:30000,maxAttempts:10};

test('receiver retry policy doubles then caps, and stops at max attempts',()=>{
 assert.deepEqual(decideExternalAlertReceiverRetry(policy,1),
  {retry:true,delayMs:1000});
 assert.deepEqual(decideExternalAlertReceiverRetry(policy,2),
  {retry:true,delayMs:2000});
 assert.deepEqual(decideExternalAlertReceiverRetry(policy,6),
  {retry:true,delayMs:30000});
 assert.deepEqual(decideExternalAlertReceiverRetry(policy,9),
  {retry:true,delayMs:30000});
 assert.deepEqual(decideExternalAlertReceiverRetry(policy,10),
  {retry:false,delayMs:null});
 assert.deepEqual(decideExternalAlertReceiverRetry(policy,2147483647),
  {retry:false,delayMs:null});
});

test('receiver retry policy rejects invalid budgets and attempt counts',()=>{
 for(const patch of [
  {baseDelayMs:999},{baseDelayMs:300001},{maxDelayMs:999},
  {maxDelayMs:3600001},{maxAttempts:0},{maxAttempts:101},
  {maxAttempts:NaN},{maxDelayMs:Infinity},
 ]){
  assert.throws(()=>decideExternalAlertReceiverRetry({...policy,...patch},1),
   /invalid_external_alert_receiver_retry_policy/);
 }
 for(const attempts of [0,-1,1.5,NaN,Infinity,2147483648])
  assert.throws(()=>decideExternalAlertReceiverRetry(policy,attempts),
   /invalid_external_alert_receiver_retry_policy/);
});

test('retry policy never invokes getter or accepts inherited fields',()=>{
 let reads=0;
 for(const key of ['baseDelayMs','maxDelayMs','maxAttempts'] as const){
  const accessor=Object.defineProperty({...policy},key,{
   get(){reads++;throw new Error('should not run');},
  });
  assert.throws(()=>decideExternalAlertReceiverRetry(accessor,1),
   /invalid_external_alert_receiver_retry_policy/);
  const inherited=Object.assign(Object.create({[key]:policy[key]}),policy);
  delete inherited[key];
  assert.throws(()=>decideExternalAlertReceiverRetry(inherited,1),
   /invalid_external_alert_receiver_retry_policy/);
 }
 assert.equal(reads,0);
});

test('small max delay clamps safely without unbounded exponential arithmetic',()=>{
 const result=decideExternalAlertReceiverRetry({
  baseDelayMs:300000,maxDelayMs:3600000,maxAttempts:100,
 },99);
 assert.deepEqual(result,{retry:true,delayMs:3600000});
});
