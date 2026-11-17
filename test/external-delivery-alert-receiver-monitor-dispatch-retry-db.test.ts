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
import {dispatchExternalAlertReceiverMonitoring}
 from '../src/modules/notifications/external-delivery-alert-receiver-monitor-dispatch.js';

test('receiver monitor dispatch transitions retry backlog to expired lease, then clears on ACK',async()=>{
 const db=new Client({connectionString:process.env.DATABASE_URL});
 await db.connect();
 await db.query('BEGIN');
 const suffix=randomUUID().replaceAll('-','').slice(0,18);
 const scope='retry-dispatch-'+suffix;
 const other='retry-other-'+suffix;
 const key=(c:string)=>'services-alert-v2-'+c.repeat(64);
 const alert=[{code:'DUE_BACKLOG',severity:'warning',observed:2,threshold:2}] as const;
 const policy={retryScheduled:1,leasedExpired:1,terminal:1,inconsistent:1};
 const sends:unknown[]=[];
 const transport={send:async(value:readonly unknown[])=>{
  assert.equal(Object.isFrozen(value),true);
  sends.push(value);
 }};
 try{
  assert.equal(await acceptExternalDeliveryAlertIngress(db,scope,key('a'),alert),'accepted');
  assert.equal(await acceptExternalDeliveryAlertIngress(db,other,key('b'),alert),'accepted');
  const first=await claimExternalAlertReceiverIngress(db,scope,1,5000);
  assert.equal(first.length,1);
  assert.equal(await scheduleExternalAlertReceiverRetry(
   db,scope,first[0].id,first[0].token,300000),'scheduled');
  assert.deepEqual(await dispatchExternalAlertReceiverMonitoring(
   db,scope,policy,transport),[
   {code:'RETRY_BACKLOG',observed:1,threshold:1},
  ]);
  assert.equal(sends.length,1);
  assert.deepEqual(await dispatchExternalAlertReceiverMonitoring(
   db,other,policy,transport),[]);
  assert.equal(sends.length,1);
  await db.query(`
   UPDATE notification_alert_receiver_retry_schedule
   SET next_attempt_at=clock_timestamp()-interval '1 second'
   WHERE ingress_id=$1
  `,[first[0].id]);
  await db.query(`
   UPDATE notification_alert_receiver_ingress
   SET lease_expires_at=clock_timestamp()-interval '1 second'
   WHERE id=$1
  `,[first[0].id]);
  assert.deepEqual(await dispatchExternalAlertReceiverMonitoring(
   db,scope,policy,transport),[
   {code:'EXPIRED_LEASES',observed:1,threshold:1},
  ]);
  assert.equal(sends.length,2);
  const second=await claimExternalAlertReceiverIngress(db,scope,1,5000);
  assert.equal(second.length,1);
  assert.equal(second[0].id,first[0].id);
  assert.notEqual(second[0].token,first[0].token);
  assert.equal(await acknowledgeClaimedExternalAlertReceiverIngress(
   db,scope,first[0].id,first[0].token),'stale');
  assert.deepEqual(await dispatchExternalAlertReceiverMonitoring(
   db,scope,policy,transport),[]);
  assert.equal(await acknowledgeClaimedExternalAlertReceiverIngress(
   db,scope,second[0].id,second[0].token),'acknowledged');
  assert.deepEqual(await dispatchExternalAlertReceiverMonitoring(
   db,scope,policy,transport),[]);
  assert.equal(sends.length,2);
  const serialized=JSON.stringify(sends);
  for(const privateValue of [scope,other,first[0].id,first[0].token,
   second[0].token,key('a')])
   assert.equal(serialized.includes(privateValue),false);
 }finally{
  await db.query('ROLLBACK').catch(()=>{});
  await db.end();
 }
});
