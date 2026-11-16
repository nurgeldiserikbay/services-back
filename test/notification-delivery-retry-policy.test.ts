import assert from 'node:assert/strict';
import {test} from 'node:test';
import {planNotificationRetry} from '../src/modules/notifications/delivery-retry-policy.js';

test('notification retry uses bounded exponential backoff and terminal failure',()=>{
 const now=new Date('2026-11-16T00:00:00.000Z');
 for(const [attempt,seconds] of [[1,30],[2,60],[3,120],[4,240]]){
  const decision=planNotificationRetry(attempt,now);
  assert.equal(decision.state,'PENDING');
  assert.equal(decision.nextAttemptAt?.getTime(),now.getTime()+seconds*1000);
 }
 assert.deepEqual(planNotificationRetry(5,now),{state:'FAILED',nextAttemptAt:null});
 assert.deepEqual(planNotificationRetry(20,now,20),{state:'FAILED',nextAttemptAt:null});
 assert.equal(planNotificationRetry(12,now,20).nextAttemptAt?.getTime(),now.getTime()+1_800_000);
});

test('notification retry rejects malformed budgets and dates before any persistence',()=>{
 const now=new Date();
 for(const n of [0,-1,1.5,NaN,Infinity]){
  assert.throws(()=>planNotificationRetry(n,now),RangeError);
 }
 for(const max of [0,-1,21,1.5,NaN,Infinity]){
  assert.throws(()=>planNotificationRetry(1,now,max),RangeError);
 }
 assert.throws(()=>planNotificationRetry(1,new Date(NaN)),RangeError);
 assert.throws(()=>planNotificationRetry(1,new Date(8_640_000_000_000_000)),RangeError);
});
