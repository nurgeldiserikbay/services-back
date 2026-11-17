import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Client} from 'pg';
import {previewConfiguredExternalAlertReceiverMonitoring}
 from '../src/modules/notifications/external-delivery-alert-receiver-monitor-preview.js';
import {acceptExternalDeliveryAlertIngress}
 from '../src/modules/notifications/external-delivery-alert-receiver-ingress.js';
import {claimExternalAlertReceiverIngress}
 from '../src/modules/notifications/external-delivery-alert-receiver-claim.js';
import {recordExternalAlertReceiverDeliveryFailure}
 from '../src/modules/notifications/external-delivery-alert-receiver-failure.js';

const config=(terminal:string)=>({
 retryScheduled:'1',leasedExpired:'1',terminal,inconsistent:'1',
});

test('receiver staging preview rejects invalid config before SQL and propagates database failure',async()=>{
 let calls=0;
 const db={query:async()=>{calls++;throw Error('query not expected');}} as never;
 await assert.rejects(previewConfiguredExternalAlertReceiverMonitoring(
  db,'staging-kz',config('0')),
  /invalid_external_alert_receiver_monitor_config/);
 await assert.rejects(previewConfiguredExternalAlertReceiverMonitoring(
  db,'BAD_SCOPE',config('1')),
  /invalid_external_alert_receiver_monitor_input/);
 assert.equal(calls,0);
 await assert.rejects(previewConfiguredExternalAlertReceiverMonitoring(
  db,'staging-kz',config('1')),
  /query not expected/);
 assert.equal(calls,1);
});

test('PostgreSQL staging preview is count-only, scoped and threshold-sensitive without transport',async()=>{
 const db=new Client({connectionString:process.env.DATABASE_URL});
 await db.connect();
 await db.query('BEGIN');
 const suffix=randomUUID().replaceAll('-','').slice(0,18);
 const scope='preview-'+suffix;
 const other='preview-other-'+suffix;
 const key=(char:string)=>'services-alert-v2-'+char.repeat(64);
 const alerts=[{code:'DUE_BACKLOG',severity:'warning',observed:2,threshold:2}] as const;
 try{
  assert.equal(await acceptExternalDeliveryAlertIngress(db,scope,key('a'),alerts),'accepted');
  assert.equal(await acceptExternalDeliveryAlertIngress(db,other,key('b'),alerts),'accepted');
  const claimed=await claimExternalAlertReceiverIngress(db,scope,1,30000);
  assert.equal(claimed.length,1);
  assert.equal(await recordExternalAlertReceiverDeliveryFailure(
   db,scope,claimed[0].id,claimed[0].token,
   {baseDelayMs:60000,maxDelayMs:60000,maxAttempts:1}),'terminal');
  const high=await previewConfiguredExternalAlertReceiverMonitoring(
   db,scope,config('2'));
  assert.deepEqual(high,[]);
  assert.equal(Object.isFrozen(high),true);
  const ready=await previewConfiguredExternalAlertReceiverMonitoring(
   db,scope,config('1'));
  assert.deepEqual(ready,[{code:'TERMINAL_FAILURES',observed:1,threshold:1}]);
  assert.equal(Object.isFrozen(ready),true);
  assert.equal(Object.isFrozen(ready[0]),true);
  assert.deepEqual(await previewConfiguredExternalAlertReceiverMonitoring(
   db,other,config('1')),[]);
  const serialized=JSON.stringify(ready);
  for(const secret of [scope,other,key('a'),claimed[0].id,claimed[0].token])
   assert.equal(serialized.includes(secret),false);
 }finally{
  await db.query('ROLLBACK').catch(()=>{});
  await db.end();
 }
});
