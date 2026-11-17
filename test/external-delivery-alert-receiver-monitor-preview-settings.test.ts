import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readReceiverMonitorPreviewSettings}
 from '../src/modules/notifications/external-delivery-alert-receiver-monitor-preview-settings.js';

const valid=()=>({
 RECEIVER_MONITOR_SCOPE:'staging-kz',
 RECEIVER_MONITOR_PREVIEW_ACK:'READ_ONLY_STAGING',
 RECEIVER_MONITOR_RETRY_SCHEDULED:'2',
 RECEIVER_MONITOR_LEASED_EXPIRED:'1',
 RECEIVER_MONITOR_TERMINAL:'3',
 RECEIVER_MONITOR_INCONSISTENT:'1',
});

test('staging preview settings are explicit, frozen and contain no credentials',()=>{
 const parsed=readReceiverMonitorPreviewSettings(valid());
 assert.deepEqual(parsed,{
  receiverScope:'staging-kz',
  thresholds:{retryScheduled:'2',leasedExpired:'1',
   terminal:'3',inconsistent:'1'},
 });
 assert.equal(Object.isFrozen(parsed),true);
 assert.equal(Object.isFrozen(parsed.thresholds),true);
 assert.equal(JSON.stringify(parsed).includes('DATABASE_URL'),false);
});

test('staging preview rejects missing, unsafe and getter-backed settings',()=>{
 let reads=0;
 const getter=Object.defineProperty(valid(),'RECEIVER_MONITOR_TERMINAL',{
  get(){reads++;throw new Error('getter should not execute');},
 });
 const cases=[
  {},{...valid(),RECEIVER_MONITOR_PREVIEW_ACK:undefined},
  {...valid(),RECEIVER_MONITOR_PREVIEW_ACK:'PRODUCTION'},
  {...valid(),RECEIVER_MONITOR_SCOPE:'BAD_SCOPE'},
  {...valid(),RECEIVER_MONITOR_SCOPE:''},
  {...valid(),RECEIVER_MONITOR_SCOPE:'a'.repeat(65)},
  {...valid(),RECEIVER_MONITOR_TERMINAL:'0'},
  {...valid(),RECEIVER_MONITOR_TERMINAL:'01'},
  {...valid(),RECEIVER_MONITOR_TERMINAL:'9007199254740992'},
  {...valid(),RECEIVER_MONITOR_RETRY_SCHEDULED:undefined},
  getter,
 ];
 for(const item of cases)
  assert.throws(()=>readReceiverMonitorPreviewSettings(item),
   /invalid_external_alert_receiver_preview_config/);
 assert.equal(reads,0);
});
