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
import {observeExternalAlertReceiver}
 from '../src/modules/notifications/external-delivery-alert-receiver-observation.js';

test('PostgreSQL receiver observation tracks expired lease, reclaimed lease and ACK without stale ownership',async()=>{
 const db=new Client({connectionString:process.env.DATABASE_URL});
 await db.connect();
 await db.query('BEGIN');
 const suffix=randomUUID().replaceAll('-','').slice(0,18);
 const scope='lease-'+suffix;
 const other='isolated-'+suffix;
 const alerts=[{code:'DUE_BACKLOG',severity:'warning',observed:2,threshold:2}] as const;
 const thresholds={retryScheduled:1,leasedExpired:1,terminal:1,inconsistent:1};
 const key=(char:string)=>'services-alert-v2-'+char.repeat(64);
 try{
  assert.equal(await acceptExternalDeliveryAlertIngress(db,scope,key('a'),alerts),'accepted');
  assert.equal(await acceptExternalDeliveryAlertIngress(db,other,key('b'),alerts),'accepted');
  const first=await claimExternalAlertReceiverIngress(db,scope,1,5000);
  assert.equal(first.length,1);
  assert.equal((await observeExternalAlertReceiver(db,scope,thresholds)).counts.leasedActive,1);
  await db.query(`
   UPDATE notification_alert_receiver_ingress
   SET lease_expires_at=clock_timestamp()-interval '1 second'
   WHERE id=$1
  `,[first[0].id]);
  const expired=await observeExternalAlertReceiver(db,scope,thresholds);
  assert.deepEqual(expired.breaches,[
   {code:'EXPIRED_LEASES',observed:1,threshold:1},
  ]);
  assert.equal(expired.counts.leasedExpired,1);
  assert.equal(expired.counts.leasedActive,0);
  assert.equal(expired.counts.total,1);
  assert.deepEqual((await observeExternalAlertReceiver(db,other,thresholds)).breaches,[]);
  const second=await claimExternalAlertReceiverIngress(db,scope,1,5000);
  assert.equal(second.length,1);
  assert.equal(second[0].id,first[0].id);
  assert.notEqual(second[0].token,first[0].token);
  assert.equal(await acknowledgeClaimedExternalAlertReceiverIngress(
   db,scope,first[0].id,first[0].token),'stale');
  const reclaimed=await observeExternalAlertReceiver(db,scope,thresholds);
  assert.equal(reclaimed.counts.leasedActive,1);
  assert.deepEqual(reclaimed.breaches,[]);
  assert.equal(await acknowledgeClaimedExternalAlertReceiverIngress(
   db,scope,second[0].id,second[0].token),'acknowledged');
  const finished=await observeExternalAlertReceiver(db,scope,thresholds);
  assert.equal(finished.counts.acknowledged,1);
  assert.equal(finished.counts.leasedExpired,0);
  assert.equal(finished.counts.total,1);
  assert.deepEqual(finished.breaches,[]);
  for(const value of [scope,first[0].token,second[0].token,key('a')])
   assert.equal(JSON.stringify(finished).includes(value),false);
 }finally{
  await db.query('ROLLBACK').catch(()=>{});
  await db.end();
 }
});
