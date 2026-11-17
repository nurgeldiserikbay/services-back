import {test} from 'node:test';
import assert from 'node:assert/strict';
import {evaluateExternalAlertReceiverMonitor}
 from '../src/modules/notifications/external-delivery-alert-receiver-monitor-policy.js';

const empty=()=>({ready:0,retryScheduled:0,leasedActive:0,
 leasedExpired:0,terminal:0,acknowledged:0,inconsistent:0,total:0});
const limits=()=>({retryScheduled:2,leasedExpired:1,terminal:1,inconsistent:1});

test('receiver monitor policy is aggregate-only, deterministic and threshold inclusive',()=>{
 const count={...empty(),retryScheduled:2,leasedExpired:1,
  terminal:1,inconsistent:1,total:5};
 assert.deepEqual(evaluateExternalAlertReceiverMonitor(count,limits()),[
  {code:'RETRY_BACKLOG',observed:2,threshold:2},
  {code:'EXPIRED_LEASES',observed:1,threshold:1},
  {code:'TERMINAL_FAILURES',observed:1,threshold:1},
  {code:'INCONSISTENT_STATE',observed:1,threshold:1},
 ]);
 const breaches=evaluateExternalAlertReceiverMonitor(count,limits());
 assert.equal(Object.isFrozen(breaches),true);
 assert.equal(Object.isFrozen(breaches[0]),true);
 assert.equal(JSON.stringify(breaches).includes('receiverScope'),false);
 assert.deepEqual(evaluateExternalAlertReceiverMonitor(empty(),limits()),[]);
 assert.deepEqual(evaluateExternalAlertReceiverMonitor(
  {...empty(),ready:5,total:5},limits()),[]);
});

test('receiver monitor policy rejects tampering, malformed totals and unsafe numbers',()=>{
 let accessorReads=0;
 const accessor=Object.defineProperty({...empty()},'ready',{
  get(){accessorReads++;throw Error('must not read getter');},enumerable:true,
 });
 const invalidCounts=[
  accessor,
  {...empty(),total:1},
  {...empty(),ready:2,total:1},
  {...empty(),ready:-1},
  {...empty(),ready:Number.MAX_SAFE_INTEGER+1},
  {...empty(),total:NaN},
  {...empty(),extra:'private'},
  Object.assign(Object.create(null),{...empty(),inconsistent:'0'}),
 ];
 for(const counts of invalidCounts){
  assert.throws(()=>evaluateExternalAlertReceiverMonitor(counts,limits()),
   /invalid_external_alert_receiver_monitor_policy/);
 }
 assert.equal(accessorReads,0);
});

test('receiver monitor rejects malformed or accessor policy without triggering getters',()=>{
 let reads=0;
 for(const thresholds of [
  {...limits(),terminal:0},
  {...limits(),leasedExpired:Infinity},
  {...limits(),retryScheduled:1.2},
  {...limits(),inconsistent:'1'},
  {...limits(),extra:'secret'},
  Object.defineProperty({...limits()},'terminal',{
   get(){reads++;throw Error('must not read getter');},enumerable:true,
  }),
 ]){
  assert.throws(()=>evaluateExternalAlertReceiverMonitor(empty(),thresholds as never),
   /invalid_external_alert_receiver_monitor_policy/);
 }
 assert.equal(reads,0);
});
