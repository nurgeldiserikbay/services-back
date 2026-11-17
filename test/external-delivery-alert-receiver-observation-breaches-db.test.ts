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
import {observeExternalAlertReceiver}
 from '../src/modules/notifications/external-delivery-alert-receiver-observation.js';

test('PostgreSQL receiver observation flags durable retry and terminal counts without leaking scope',async()=>{
 const db=new Client({connectionString:process.env.DATABASE_URL});
 await db.connect();
 await db.query('BEGIN');
 const suffix=randomUUID().replaceAll('-','').slice(0,18);
 const scope='alert-'+suffix;
 const other='isolation-'+suffix;
 const alerts=[{code:'DUE_BACKLOG',severity:'warning',observed:2,threshold:2}] as const;
 const key=(c:string)=>'services-alert-v2-'+c.repeat(64);
 const thresholds={retryScheduled:1,leasedExpired:1,terminal:1,inconsistent:1};
 try{
  assert.equal(await acceptExternalDeliveryAlertIngress(db,scope,key('e'),alerts),'accepted');
  assert.equal(await acceptExternalDeliveryAlertIngress(db,scope,key('f'),alerts),'accepted');
  assert.equal(await acceptExternalDeliveryAlertIngress(db,other,key('a'),alerts),'accepted');
  const leased=await claimExternalAlertReceiverIngress(db,scope,2,30000);
  assert.equal(leased.length,2);
  assert.equal(await recordExternalAlertReceiverDeliveryFailure(
   db,scope,leased[0].id,leased[0].token,
   {baseDelayMs:60000,maxDelayMs:60000,maxAttempts:2}),'scheduled');
  assert.equal(await recordExternalAlertReceiverDeliveryFailure(
   db,scope,leased[1].id,leased[1].token,
   {baseDelayMs:60000,maxDelayMs:60000,maxAttempts:1}),'terminal');
  const observed=await observeExternalAlertReceiver(db,scope,thresholds);
  assert.deepEqual(observed.counts,{
   ready:0,retryScheduled:1,leasedActive:0,leasedExpired:0,
   terminal:1,acknowledged:0,inconsistent:0,total:2,
  });
  assert.deepEqual(observed.breaches,[
   {code:'RETRY_BACKLOG',observed:1,threshold:1},
   {code:'TERMINAL_FAILURES',observed:1,threshold:1},
  ]);
  assert.equal(JSON.stringify(observed).includes(scope),false);
  assert.equal(JSON.stringify(observed).includes(leased[0].token),false);
  assert.equal(JSON.stringify(observed).includes(key('e')),false);
  const isolated=await observeExternalAlertReceiver(db,other,thresholds);
  assert.equal(isolated.counts.ready,1);
  assert.equal(isolated.counts.retryScheduled,0);
  assert.equal(isolated.counts.terminal,0);
  assert.deepEqual(isolated.breaches,[]);
  const below=await observeExternalAlertReceiver(db,scope,{
   ...thresholds,retryScheduled:2,terminal:2,
  });
  assert.deepEqual(below.breaches,[]);
 }finally{
  await db.query('ROLLBACK').catch(()=>{});
  await db.end();
 }
});
