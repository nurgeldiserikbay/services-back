import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Client} from 'pg';
import {acceptExternalDeliveryAlertIngress}
 from '../src/modules/notifications/external-delivery-alert-receiver-ingress.js';
import {claimExternalAlertReceiverIngress}
 from '../src/modules/notifications/external-delivery-alert-receiver-claim.js';
import {recordExternalAlertReceiverDeliveryFailure}
 from '../src/modules/notifications/external-delivery-alert-receiver-failure.js';
import {dispatchOneShotReceiverStagingMonitoring}
 from '../src/modules/notifications/external-delivery-alert-receiver-monitor-staging-dispatch.js';

const policy=()=>({
 retryScheduled:'1',leasedExpired:'1',terminal:'1',inconsistent:'1',
});
const alerts=[{
 code:'DUE_BACKLOG',severity:'warning',observed:2,threshold:2,
}] as const;

test('one-shot staging counts distinguish detected breaches from actually sent breaches',async()=>{
 const db=new Client({connectionString:process.env.DATABASE_URL});
 await db.connect();
 await db.query('BEGIN');
 const scope='send-count-'+randomUUID().replaceAll('-','').slice(0,18);
 let sent=0;
 const transport={send:async(values:readonly unknown[])=>{
  assert.deepEqual(values,[{
   code:'TERMINAL_FAILURES',observed:1,threshold:1,
  }]);
  sent++;
 }};
 try{
  assert.equal(await acceptExternalDeliveryAlertIngress(
   db,scope,'services-alert-v2-'+'a'.repeat(64),alerts),'accepted');
  const claimed=await claimExternalAlertReceiverIngress(db,scope,1,30000);
  assert.equal(claimed.length,1);
  assert.equal(await recordExternalAlertReceiverDeliveryFailure(
   db,scope,claimed[0].id,claimed[0].token,
   {baseDelayMs:60000,maxDelayMs:60000,maxAttempts:1}),'terminal');
  const first=await dispatchOneShotReceiverStagingMonitoring(
   db,scope,policy(),transport,3600);
  assert.deepEqual(first,{breachCount:1,sentCount:1});
  assert.equal(Object.isFrozen(first),true);
  const suppressed=await dispatchOneShotReceiverStagingMonitoring(
   db,scope,policy(),transport,3600);
  assert.deepEqual(suppressed,{breachCount:1,sentCount:0});
  assert.equal(sent,1);
  const withoutCooldown=await dispatchOneShotReceiverStagingMonitoring(
   db,scope,policy(),transport);
  assert.deepEqual(withoutCooldown,{breachCount:1,sentCount:1});
  assert.equal(sent,2);
 }finally{
  await db.query('ROLLBACK').catch(()=>{});
  await db.end();
 }
});

test('one-shot staging transport failure never records a successful sentCount',async()=>{
 const db=new Client({connectionString:process.env.DATABASE_URL});
 await db.connect();
 await db.query('BEGIN');
 const scope='send-failure-'+randomUUID().replaceAll('-','').slice(0,18);
 try{
  assert.equal(await acceptExternalDeliveryAlertIngress(
   db,scope,'services-alert-v2-'+'b'.repeat(64),alerts),'accepted');
  const claimed=await claimExternalAlertReceiverIngress(db,scope,1,30000);
  assert.equal(claimed.length,1);
  assert.equal(await recordExternalAlertReceiverDeliveryFailure(
   db,scope,claimed[0].id,claimed[0].token,
   {baseDelayMs:60000,maxDelayMs:60000,maxAttempts:1}),'terminal');
  await assert.rejects(dispatchOneShotReceiverStagingMonitoring(
   db,scope,policy(),{send:async()=>{throw Error('provider unavailable');}},3600),
   /provider unavailable/);
  const retry=await dispatchOneShotReceiverStagingMonitoring(
   db,scope,policy(),{send:async()=>{}},3600);
  assert.deepEqual(retry,{breachCount:1,sentCount:1});
 }finally{
  await db.query('ROLLBACK').catch(()=>{});
  await db.end();
 }
});
