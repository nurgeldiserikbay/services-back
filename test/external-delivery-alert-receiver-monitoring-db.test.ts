import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Client} from 'pg';
import {acceptExternalDeliveryAlertIngress}
 from '../src/modules/notifications/external-delivery-alert-receiver-ingress.js';
import {claimExternalAlertReceiverIngress}
 from '../src/modules/notifications/external-delivery-alert-receiver-claim.js';
import {scheduleExternalAlertReceiverRetry}
 from '../src/modules/notifications/external-delivery-alert-receiver-retry-schedule.js';
import {acknowledgeClaimedExternalAlertReceiverIngress}
 from '../src/modules/notifications/external-delivery-alert-receiver-ack.js';
import {readExternalAlertReceiverCounts}
 from '../src/modules/notifications/external-delivery-alert-receiver-monitoring.js';

const keys=['ready','retry_scheduled','leased_active','leased_expired',
 'terminal','acknowledged','inconsistent','total'] as const;

test('receiver monitoring rejects untrusted scope and SQL before reading metrics',async()=>{
 let queries=0;
 const db={query:async()=>{queries++;throw new Error('unexpected');}} as never;
 await assert.rejects(readExternalAlertReceiverCounts(db,'PROD'),
  /invalid_external_alert_receiver_monitor_input/);
 await assert.rejects(readExternalAlertReceiverCounts(db,''),
  /invalid_external_alert_receiver_monitor_input/);
 assert.equal(queries,0);
});

test('receiver monitoring rejects accessor rows, mismatched totals and overflows',async()=>{
 let reads=0;
 const valid=Object.fromEntries(keys.map(key=>[key,'0']));
 for(const row of [
  Object.defineProperty({...valid},'ready',{
   get(){reads++;throw new Error('should not execute');},
  }),
  {...valid,total:'1'},
  {...valid,terminal:'9007199254740992'},
  {...valid,total:'-1'},
  {...valid,ready:1},
 ]){
  const db={query:async()=>({rows:[row]})} as never;
  await assert.rejects(readExternalAlertReceiverCounts(db,'staging-kz'),
   /invalid_external_alert_receiver_monitor_snapshot/);
 }
 assert.equal(reads,0);
});

test('PostgreSQL receiver inventory is aggregate-only and deployment-scoped',async()=>{
 const db=new Client({connectionString:process.env.DATABASE_URL});
 await db.connect();
 await db.query('BEGIN');
 const scope='staging-'+randomUUID().replaceAll('-','').slice(0,18);
 const other='prod-'+randomUUID().replaceAll('-','').slice(0,18);
 const alerts=[{code:'DUE_BACKLOG',severity:'warning',observed:2,threshold:2}] as const;
 const k=(char:string)=>'services-alert-v2-'+char.repeat(64);
 try{
  for(const char of ['a','b','c']){
   assert.equal(await acceptExternalDeliveryAlertIngress(
    db,scope,k(char),alerts),'accepted');
  }
  assert.equal(await acceptExternalDeliveryAlertIngress(
   db,other,k('d'),alerts),'accepted');
  const initial=await readExternalAlertReceiverCounts(db,scope);
  assert.deepEqual(initial,{ready:3,retryScheduled:0,leasedActive:0,
   leasedExpired:0,terminal:0,acknowledged:0,inconsistent:0,total:3});
  const claimed=await claimExternalAlertReceiverIngress(db,scope,2,30000);
  assert.equal(claimed.length,2);
  const leased=await readExternalAlertReceiverCounts(db,scope);
  assert.equal(leased.leasedActive,2);
  assert.equal(leased.ready,1);
  await scheduleExternalAlertReceiverRetry(
   db,scope,claimed[0].id,claimed[0].token,300000);
  const deferred=await readExternalAlertReceiverCounts(db,scope);
  assert.equal(deferred.retryScheduled,1);
  assert.equal(deferred.leasedActive,1);
  assert.equal(await acknowledgeClaimedExternalAlertReceiverIngress(
   db,scope,claimed[1].id,claimed[1].token),'acknowledged');
  const after=await readExternalAlertReceiverCounts(db,scope);
  assert.deepEqual(after,{ready:1,retryScheduled:1,leasedActive:0,
   leasedExpired:0,terminal:0,acknowledged:1,inconsistent:0,total:3});
  const isolated=await readExternalAlertReceiverCounts(db,other);
  assert.deepEqual(isolated,{ready:1,retryScheduled:0,leasedActive:0,
   leasedExpired:0,terminal:0,acknowledged:0,inconsistent:0,total:1});
  assert.equal(JSON.stringify(after).includes(k('a')),false);
  assert.equal(JSON.stringify(after).includes(claimed[0].token),false);
 }finally{
  await db.query('ROLLBACK').catch(()=>{});
  await db.end();
 }
});
