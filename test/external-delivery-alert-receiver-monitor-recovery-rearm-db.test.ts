import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Client} from 'pg';
import {recordReceiverMonitoringDelivered,
 clearRecoveredReceiverMonitoringDeliveryState}
 from '../src/modules/notifications/external-delivery-alert-receiver-monitor-delivery-state.js';
import {dispatchOneShotReceiverStagingMonitoring}
 from '../src/modules/notifications/external-delivery-alert-receiver-monitor-staging-dispatch.js';
import {acceptExternalDeliveryAlertIngress}
 from '../src/modules/notifications/external-delivery-alert-receiver-ingress.js';
import {claimExternalAlertReceiverIngress}
 from '../src/modules/notifications/external-delivery-alert-receiver-claim.js';
import {recordExternalAlertReceiverDeliveryFailure}
 from '../src/modules/notifications/external-delivery-alert-receiver-failure.js';

const terminal={code:'TERMINAL_FAILURES' as const,observed:1,threshold:1};
const retry={code:'RETRY_BACKLOG' as const,observed:1,threshold:1};
const policy={
 retryScheduled:'1',leasedExpired:'1',terminal:'1',inconsistent:'1',
};

test('successful healthy observation clears stale suppression and rearms new breach',async()=>{
 const db=new Client({connectionString:process.env.DATABASE_URL});
 await db.connect();
 await db.query('BEGIN');
 const scope='rearm-'+randomUUID().replaceAll('-','').slice(0,18);
 let sends=0;
 const transport={send:async()=>{sends++;}};
 try{
  // Simulate an earlier successfully delivered breach still inside cooldown.
  await recordReceiverMonitoringDelivered(db,scope,[terminal]);
  const healthy=await dispatchOneShotReceiverStagingMonitoring(
   db,scope,policy,transport,3600);
  assert.deepEqual(healthy,{breachCount:0,sentCount:0});
  assert.equal(sends,0);
  const cleared=await db.query<{count:string}>(
   'SELECT count(*)::text AS count FROM notification_receiver_monitor_delivery_state WHERE receiver_scope=$1',
   [scope]);
  assert.equal(cleared.rows[0].count,'0');
  const alerts=[{
   code:'DUE_BACKLOG',severity:'warning',observed:2,threshold:2,
  }] as const;
  assert.equal(await acceptExternalDeliveryAlertIngress(
   db,scope,'services-alert-v2-'+'d'.repeat(64),alerts),'accepted');
  const claimed=await claimExternalAlertReceiverIngress(db,scope,1,30000);
  assert.equal(claimed.length,1);
  assert.equal(await recordExternalAlertReceiverDeliveryFailure(
   db,scope,claimed[0].id,claimed[0].token,
   {baseDelayMs:60000,maxDelayMs:60000,maxAttempts:1}),'terminal');
  const newEpisode=await dispatchOneShotReceiverStagingMonitoring(
   db,scope,policy,transport,3600);
  assert.deepEqual(newEpisode,{breachCount:1,sentCount:1});
  assert.equal(sends,1);
  const repeat=await dispatchOneShotReceiverStagingMonitoring(
   db,scope,policy,transport,3600);
  assert.deepEqual(repeat,{breachCount:1,sentCount:0});
  assert.equal(sends,1);
 }finally{
  await db.query('ROLLBACK').catch(()=>{});
  await db.end();
 }
});

test('recovery clears only missing codes within receiver scope',async()=>{
 const db=new Client({connectionString:process.env.DATABASE_URL});
 await db.connect();
 await db.query('BEGIN');
 const scope='rearm-partial-'+randomUUID().replaceAll('-','').slice(0,18);
 const other='rearm-unrelated-'+randomUUID().replaceAll('-','').slice(0,18);
 try{
  await recordReceiverMonitoringDelivered(db,scope,[terminal,retry]);
  await recordReceiverMonitoringDelivered(db,other,[terminal]);
  await clearRecoveredReceiverMonitoringDeliveryState(db,scope,[terminal]);
  const scoped=await db.query<{code:string}>(
   'SELECT code FROM notification_receiver_monitor_delivery_state WHERE receiver_scope=$1',
   [scope]);
  assert.deepEqual(scoped.rows,[{code:'TERMINAL_FAILURES'}]);
  const unaffected=await db.query<{code:string}>(
   'SELECT code FROM notification_receiver_monitor_delivery_state WHERE receiver_scope=$1',
   [other]);
  assert.deepEqual(unaffected.rows,[{code:'TERMINAL_FAILURES'}]);
 }finally{
  await db.query('ROLLBACK').catch(()=>{});
  await db.end();
 }
});

test('invalid recovery scope and fabricated breach fields reject before SQL',async()=>{
 let calls=0;
 const db={query:async()=>{calls++;throw Error('unexpected SQL');}} as never;
 await assert.rejects(clearRecoveredReceiverMonitoringDeliveryState(
  db,'INVALID_SCOPE',[]),/invalid_receiver_monitor_delivery_state_input/);
 await assert.rejects(clearRecoveredReceiverMonitoringDeliveryState(
  db,'staging-scope',[{...terminal,privateId:'secret'}] as never),
  /invalid_receiver_monitor_delivery_state_input/);
 assert.equal(calls,0);
});
