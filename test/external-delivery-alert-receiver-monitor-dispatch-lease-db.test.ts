import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Client} from 'pg';
import {acceptExternalDeliveryAlertIngress}
 from '../src/modules/notifications/external-delivery-alert-receiver-ingress.js';
import {claimExternalAlertReceiverIngress}
 from '../src/modules/notifications/external-delivery-alert-receiver-claim.js';
import {acknowledgeClaimedExternalAlertReceiverIngress}
 from '../src/modules/notifications/external-delivery-alert-receiver-ack.js';
import {dispatchExternalAlertReceiverMonitoring}
 from '../src/modules/notifications/external-delivery-alert-receiver-monitor-dispatch.js';

test('receiver monitoring dispatch reports expired lease once and suppresses after reclaim and ACK',async()=>{
 const db=new Client({connectionString:process.env.DATABASE_URL});
 await db.connect();
 await db.query('BEGIN');
 const suffix=randomUUID().replaceAll('-','').slice(0,18);
 const scope='dispatch-lease-'+suffix;
 const other='dispatch-other-'+suffix;
 const key=(char:string)=>'services-alert-v2-'+char.repeat(64);
 const alerts=[{code:'DUE_BACKLOG',severity:'warning',observed:2,threshold:2}] as const;
 const policy={retryScheduled:1,leasedExpired:1,terminal:1,inconsistent:1};
 const sent:unknown[]=[];
 const transport={send:async (breaches:readonly unknown[])=>{
  assert.equal(Object.isFrozen(breaches),true);
  assert.equal(Object.isFrozen(breaches[0]),true);
  sent.push(breaches);
 }};
 try{
  assert.equal(await acceptExternalDeliveryAlertIngress(db,scope,key('a'),alerts),
   'accepted');
  assert.equal(await acceptExternalDeliveryAlertIngress(db,other,key('b'),alerts),
   'accepted');
  const first=await claimExternalAlertReceiverIngress(db,scope,1,5000);
  assert.equal(first.length,1);
  assert.deepEqual(await dispatchExternalAlertReceiverMonitoring(
   db,scope,policy,transport),[]);
  assert.equal(sent.length,0);
  await db.query(`
   UPDATE notification_alert_receiver_ingress
   SET lease_expires_at=clock_timestamp()-interval '1 second'
   WHERE id=$1
  `,[first[0].id]);
  assert.deepEqual(await dispatchExternalAlertReceiverMonitoring(
   db,scope,policy,transport),[
   {code:'EXPIRED_LEASES',observed:1,threshold:1},
  ]);
  assert.equal(sent.length,1);
  const serialized=JSON.stringify(sent[0]);
  for(const privateValue of [scope,other,key('a'),first[0].id,first[0].token])
   assert.equal(serialized.includes(privateValue),false);
  assert.deepEqual(await dispatchExternalAlertReceiverMonitoring(
   db,other,policy,transport),[]);
  assert.equal(sent.length,1);
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
  assert.equal(sent.length,1);
 }finally{
  await db.query('ROLLBACK').catch(()=>{});
  await db.end();
 }
});
