import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Client} from 'pg';
import {parseReceiverMonitorThresholds}
 from '../src/modules/notifications/external-delivery-alert-receiver-monitor-config.js';
import {dispatchExternalAlertReceiverMonitoring}
 from '../src/modules/notifications/external-delivery-alert-receiver-monitor-dispatch.js';
import {acceptExternalDeliveryAlertIngress}
 from '../src/modules/notifications/external-delivery-alert-receiver-ingress.js';
import {claimExternalAlertReceiverIngress}
 from '../src/modules/notifications/external-delivery-alert-receiver-claim.js';
import {recordExternalAlertReceiverDeliveryFailure}
 from '../src/modules/notifications/external-delivery-alert-receiver-failure.js';

const raw=(terminal:string)=>({
 retryScheduled:'1',leasedExpired:'1',terminal,inconsistent:'1',
});

test('unapproved monitoring thresholds fail before PostgreSQL or transport access',async()=>{
 let queries=0,sends=0;
 const db={query:async()=>{queries++;throw Error('unexpected SQL');}} as never;
 const transport={send:async()=>{sends++;}};
 for(const invalid of [raw('0'),raw('NaN'),{...raw('1'),extra:'bad'},
  {retryScheduled:'1',leasedExpired:'1',terminal:'1'}]){
  assert.throws(()=>parseReceiverMonitorThresholds(invalid),
   /invalid_external_alert_receiver_monitor_config/);
 }
 assert.equal(queries,0);
 assert.equal(sends,0);
 const approved=parseReceiverMonitorThresholds(raw('1'));
 await assert.rejects(dispatchExternalAlertReceiverMonitoring(
  db,'INVALID_SCOPE',approved,transport),
  /invalid_external_alert_receiver_monitor_input/);
 assert.equal(queries,0);
 assert.equal(sends,0);
});

test('PostgreSQL monitor dispatch accepts explicit config and honors threshold changes',async()=>{
 const db=new Client({connectionString:process.env.DATABASE_URL});
 await db.connect();
 await db.query('BEGIN');
 const suffix=randomUUID().replaceAll('-','').slice(0,18);
 const scope='config-'+suffix;
 const other='config-other-'+suffix;
 const key=(char:string)=>'services-alert-v2-'+char.repeat(64);
 const alerts=[{code:'DUE_BACKLOG',severity:'warning',observed:2,threshold:2}] as const;
 const sent:unknown[]=[];
 const transport={send:async(breaches:readonly unknown[])=>{
  assert.equal(Object.isFrozen(breaches),true);
  assert.equal(Object.isFrozen(breaches[0]),true);
  sent.push(breaches);
 }};
 try{
  assert.equal(await acceptExternalDeliveryAlertIngress(
   db,scope,key('a'),alerts),'accepted');
  assert.equal(await acceptExternalDeliveryAlertIngress(
   db,other,key('b'),alerts),'accepted');
  const lease=await claimExternalAlertReceiverIngress(db,scope,1,30000);
  assert.equal(lease.length,1);
  assert.equal(await recordExternalAlertReceiverDeliveryFailure(
   db,scope,lease[0].id,lease[0].token,
   {baseDelayMs:60000,maxDelayMs:60000,maxAttempts:1}),'terminal');
  const high=parseReceiverMonitorThresholds(raw('2'));
  assert.deepEqual(await dispatchExternalAlertReceiverMonitoring(
   db,scope,high,transport),[]);
  assert.equal(sent.length,0);
  const approved=parseReceiverMonitorThresholds(raw('1'));
  assert.deepEqual(await dispatchExternalAlertReceiverMonitoring(
   db,scope,approved,transport),[
   {code:'TERMINAL_FAILURES',observed:1,threshold:1},
  ]);
  assert.equal(sent.length,1);
  assert.deepEqual(await dispatchExternalAlertReceiverMonitoring(
   db,other,approved,transport),[]);
  assert.equal(sent.length,1);
  const serialized=JSON.stringify(sent);
  for(const sensitive of [scope,other,key('a'),lease[0].id,lease[0].token])
   assert.equal(serialized.includes(sensitive),false);
 }finally{
  await db.query('ROLLBACK').catch(()=>{});
  await db.end();
 }
});
