import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseReceiverMonitorThresholds}
 from '../src/modules/notifications/external-delivery-alert-receiver-monitor-config.js';
import {evaluateExternalAlertReceiverMonitor}
 from '../src/modules/notifications/external-delivery-alert-receiver-monitor-policy.js';

const raw=()=>({retryScheduled:'2',leasedExpired:'1',
 terminal:'3',inconsistent:'1'});
const empty=()=>({ready:0,retryScheduled:0,leasedActive:0,
 leasedExpired:0,terminal:0,acknowledged:0,inconsistent:0,total:0});

test('explicit threshold config is complete, frozen and usable by monitor evaluator',()=>{
 const parsed=parseReceiverMonitorThresholds(raw());
 assert.deepEqual(parsed,{retryScheduled:2,leasedExpired:1,
  terminal:3,inconsistent:1});
 assert.equal(Object.isFrozen(parsed),true);
 assert.deepEqual(evaluateExternalAlertReceiverMonitor({
  ...empty(),retryScheduled:2,terminal:3,total:5,
 },parsed),[
  {code:'RETRY_BACKLOG',observed:2,threshold:2},
  {code:'TERMINAL_FAILURES',observed:3,threshold:3},
 ]);
});

test('receiver threshold parser rejects missing, extra, inherited, accessor and unsafe values',()=>{
 let reads=0;
 const unsafe=Object.defineProperty(raw(),'terminal',{
  enumerable:true,get(){reads++;throw Error('unsafe getter');},
 });
 const missing={retryScheduled:'1',leasedExpired:'1',terminal:'1'};
 const inherited=Object.create({inconsistent:'1'}) as Record<string,string>;
 Object.assign(inherited,{retryScheduled:'1',leasedExpired:'1',terminal:'1'});
 const invalid=[
  null,[],{},missing,{...raw(),extra:'secret'},unsafe,inherited,
  {...raw(),retryScheduled:1},
  {...raw(),terminal:'0'},
  {...raw(),terminal:'-1'},
  {...raw(),terminal:'1.5'},
  {...raw(),terminal:' 1'},
  {...raw(),terminal:'01'},
  {...raw(),terminal:'1e3'},
  {...raw(),terminal:'9007199254740992'},
  {...raw(),terminal:'99999999999999999'},
  {...raw(),terminal:undefined},
 ];
 for(const value of invalid)
  assert.throws(()=>parseReceiverMonitorThresholds(value),
   /invalid_external_alert_receiver_monitor_config/);
 assert.equal(reads,0);
});

test('receiver threshold parser accepts positive max-safe values but no defaults',()=>{
 const parsed=parseReceiverMonitorThresholds({
  retryScheduled:String(Number.MAX_SAFE_INTEGER),
  leasedExpired:'1',terminal:'1',inconsistent:'1',
 });
 assert.equal(parsed.retryScheduled,Number.MAX_SAFE_INTEGER);
});
