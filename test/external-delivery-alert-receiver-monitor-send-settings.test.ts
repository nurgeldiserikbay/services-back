import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readReceiverMonitorSendSettings}
 from '../src/modules/notifications/external-delivery-alert-receiver-monitor-send-settings.js';

const env=()=>({
 RECEIVER_MONITOR_ENVIRONMENT:'staging',
 RECEIVER_MONITOR_SEND_ACK:'SEND_ONCE_STAGING',
 RECEIVER_MONITOR_PREVIEW_ACK:'READ_ONLY_STAGING',
 RECEIVER_MONITOR_SCOPE:'staging-kz',
 RECEIVER_MONITOR_RETRY_SCHEDULED:'1',
 RECEIVER_MONITOR_LEASED_EXPIRED:'1',
 RECEIVER_MONITOR_TERMINAL:'1',
 RECEIVER_MONITOR_INCONSISTENT:'1',
 RECEIVER_MONITOR_ENDPOINT:'https://alerts.example.org/monitor',
 RECEIVER_MONITOR_APPROVED_HOSTNAME:'alerts.example.org',
 RECEIVER_MONITOR_BEARER_TOKEN:'z'.repeat(48),
 RECEIVER_MONITOR_TIMEOUT_MS:'2500',
});

test('staging send requires both acknowledgements and a valid operator-owned destination',()=>{
 const settings=readReceiverMonitorSendSettings(env());
 assert.equal(settings.receiverScope,'staging-kz');
 assert.equal(settings.timeoutMs,2500);
 assert.equal(Object.isFrozen(settings),true);
 for(const wrong of [
  {...env(),RECEIVER_MONITOR_ENVIRONMENT:'production'},
  {...env(),NODE_ENV:'production'},
  {...env(),RECEIVER_MONITOR_SEND_ACK:undefined},
  {...env(),RECEIVER_MONITOR_SEND_ACK:'READ_ONLY_STAGING'},
  {...env(),RECEIVER_MONITOR_PREVIEW_ACK:undefined},
  {...env(),RECEIVER_MONITOR_ENDPOINT:'http://alerts.example.org/monitor'},
  {...env(),RECEIVER_MONITOR_APPROVED_HOSTNAME:'example.net'},
  {...env(),RECEIVER_MONITOR_BEARER_TOKEN:'weak'},
  {...env(),RECEIVER_MONITOR_TIMEOUT_MS:'500'},
  {...env(),RECEIVER_MONITOR_TERMINAL:'0'},
 ])assert.throws(()=>readReceiverMonitorSendSettings(wrong),
  /invalid_external_alert_receiver_send_config/);
});

test('staging send config does not invoke accessor-backed secrets',()=>{
 let invoked=0;
 const unsafe=Object.defineProperty(env(),'RECEIVER_MONITOR_BEARER_TOKEN',{
  get(){invoked++;throw Error('getter should not execute');},
 });
 assert.throws(()=>readReceiverMonitorSendSettings(unsafe),
  /invalid_external_alert_receiver_send_config/);
 assert.equal(invoked,0);
});

test('manual dispatch command refuses missing SEND acknowledgment before database/network I/O',()=>{
 const secret='do_not_log_this_secret';
 const result=spawnSync(process.execPath,
  ['--import','tsx','scripts/send-receiver-monitor-staging.ts'],{
   cwd:process.cwd(),
   env:{
    ...process.env,...env(),
    DATABASE_URL:`postgres://user:${secret}@127.0.0.1:1/fake`,
    RECEIVER_MONITOR_BEARER_TOKEN:secret.repeat(2),
    RECEIVER_MONITOR_SEND_ACK:'',
   },
   encoding:'utf8',timeout:12000,
  });
 assert.equal(result.error,undefined);
 assert.equal(result.status,1);
 assert.equal(result.stdout,'');
 assert.equal(result.stderr,'receiver_monitor_staging_send_failed\n');
 assert.equal((result.stdout+result.stderr).includes(secret),false);
});
