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
import {dispatchConfiguredExternalAlertReceiverMonitoring}
 from '../src/modules/notifications/external-delivery-alert-receiver-monitor-configured-dispatch.js';

const thresholds=(terminal:string)=>({
 retryScheduled:'1',leasedExpired:'1',terminal,inconsistent:'1',
});

test('configured receiver monitoring sends scoped PostgreSQL terminal breach with approved threshold',async()=>{
 const db=new Client({connectionString:process.env.DATABASE_URL});
 await db.connect();
 await db.query('BEGIN');
 const suffix=randomUUID().replaceAll('-','').slice(0,18);
 const scope='configured-'+suffix;
 const other='unrelated-'+suffix;
 const alerts=[{code:'DUE_BACKLOG',severity:'warning',observed:2,threshold:2}] as const;
 const key=(c:string)=>'services-alert-v2-'+c.repeat(64);
 const sends:unknown[]=[];
 const transport={send:async(value:readonly unknown[])=>{
  assert.equal(Object.isFrozen(value),true);
  assert.equal(Object.isFrozen(value[0]),true);
  sends.push(value);
 }};
 try{
  assert.equal(await acceptExternalDeliveryAlertIngress(
   db,scope,key('a'),alerts),'accepted');
  assert.equal(await acceptExternalDeliveryAlertIngress(
   db,other,key('b'),alerts),'accepted');
  const claimed=await claimExternalAlertReceiverIngress(db,scope,1,30000);
  assert.equal(claimed.length,1);
  assert.equal(await recordExternalAlertReceiverDeliveryFailure(
   db,scope,claimed[0].id,claimed[0].token,
   {baseDelayMs:60000,maxDelayMs:60000,maxAttempts:1}),'terminal');
  assert.deepEqual(await dispatchConfiguredExternalAlertReceiverMonitoring(
   db,scope,thresholds('2'),transport),[]);
  assert.equal(sends.length,0);
  const breached=await dispatchConfiguredExternalAlertReceiverMonitoring(
   db,scope,thresholds('1'),transport);
  assert.deepEqual(breached,[{
   code:'TERMINAL_FAILURES',observed:1,threshold:1,
  }]);
  assert.equal(sends.length,1);
  assert.equal(sends[0],breached);
  assert.deepEqual(await dispatchConfiguredExternalAlertReceiverMonitoring(
   db,other,thresholds('1'),transport),[]);
  assert.equal(sends.length,1);
  for(const sensitive of [scope,other,claimed[0].id,claimed[0].token,key('a')])
   assert.equal(JSON.stringify(sends).includes(sensitive),false);
  await assert.rejects(dispatchConfiguredExternalAlertReceiverMonitoring(
   db,scope,thresholds('0'),transport),
   /invalid_external_alert_receiver_monitor_config/);
  assert.equal(sends.length,1);
 }finally{
  await db.query('ROLLBACK').catch(()=>{});
  await db.end();
 }
});
