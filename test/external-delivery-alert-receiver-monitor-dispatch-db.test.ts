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
import {dispatchExternalAlertReceiverMonitoring}
 from '../src/modules/notifications/external-delivery-alert-receiver-monitor-dispatch.js';

test('PostgreSQL receiver monitor dispatch sends scoped count-only alerts and propagates transport failure',async()=>{
 const db=new Client({connectionString:process.env.DATABASE_URL});
 await db.connect();
 await db.query('BEGIN');
 const suffix=randomUUID().replaceAll('-','').slice(0,18);
 const scope='dispatch-'+suffix;
 const other='separate-'+suffix;
 const key=(char:string)=>'services-alert-v2-'+char.repeat(64);
 const alerts=[{code:'DUE_BACKLOG',severity:'warning',observed:2,threshold:2}] as const;
 const thresholds={retryScheduled:1,leasedExpired:1,terminal:1,inconsistent:1};
 try{
  assert.equal(await acceptExternalDeliveryAlertIngress(
   db,scope,key('a'),alerts),'accepted');
  assert.equal(await acceptExternalDeliveryAlertIngress(
   db,other,key('b'),alerts),'accepted');
  let sends=0;
  const initial=await dispatchExternalAlertReceiverMonitoring(
   db,scope,thresholds,{send:async()=>{sends++;}});
  assert.deepEqual(initial,[]);
  assert.equal(sends,0);
  const leased=await claimExternalAlertReceiverIngress(db,scope,1,30000);
  assert.equal(leased.length,1);
  assert.equal(await recordExternalAlertReceiverDeliveryFailure(
   db,scope,leased[0].id,leased[0].token,
   {baseDelayMs:60000,maxDelayMs:60000,maxAttempts:1}),'terminal');
  let delivered:unknown;
  const breached=await dispatchExternalAlertReceiverMonitoring(
   db,scope,thresholds,{send:async(value)=>{
    sends++;
    delivered=value;
    assert.equal(Object.isFrozen(value),true);
    assert.equal(Object.isFrozen(value[0]),true);
   }});
  assert.equal(sends,1);
  assert.deepEqual(breached,[{code:'TERMINAL_FAILURES',observed:1,threshold:1}]);
  assert.equal(delivered,breached);
  for(const sensitive of [scope,other,key('a'),leased[0].id,leased[0].token])
   assert.equal(JSON.stringify(breached).includes(sensitive),false);
  assert.deepEqual(await dispatchExternalAlertReceiverMonitoring(
   db,other,thresholds,{send:async()=>{throw Error('other scope sent');}}),[]);
  await assert.rejects(dispatchExternalAlertReceiverMonitoring(
   db,scope,thresholds,{send:async()=>{throw Error('staging transport unavailable');}}),
   /staging transport unavailable/);
  assert.deepEqual(await dispatchExternalAlertReceiverMonitoring(
   db,scope,{...thresholds,terminal:2},
   {send:async()=>{throw Error('below threshold sent');}}),[]);
 }finally{
  await db.query('ROLLBACK').catch(()=>{});
  await db.end();
 }
});
