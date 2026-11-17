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

test('retry scheduling rejects bad token, scope and delay before SQL',async()=>{
 let queries=0;
 const db={query:async()=>{queries++;throw new Error('unexpected SQL');}} as never;
 const id=randomUUID(),token=randomUUID();
 for(const [scope,record,claim,delay] of [
  ['INVALID',id,token,1000],
  ['staging-kz','invalid',token,1000],
  ['staging-kz',id,'invalid',1000],
  ['staging-kz',id,token,999],
  ['staging-kz',id,token,3600001],
  ['staging-kz',id,token,NaN],
 ] as const){
  await assert.rejects(scheduleExternalAlertReceiverRetry(
   db,scope,record,claim,delay),
   /invalid_external_alert_receiver_retry_schedule/);
 }
 assert.equal(queries,0);
});

test('PostgreSQL receiver retry deadline blocks claims until due; old tokens cannot replace deadline',async()=>{
 const db=new Client({connectionString:process.env.DATABASE_URL});
 await db.connect();
 await db.query('BEGIN');
 const scope='staging-'+randomUUID().replaceAll('-','').slice(0,18);
 const key='services-alert-v2-'+'d'.repeat(64);
 try{
  await acceptExternalDeliveryAlertIngress(db,scope,key,[{
   code:'DUE_BACKLOG',severity:'warning',observed:3,threshold:2,
  }]);
  const first=await claimExternalAlertReceiverIngress(db,scope,1,5000);
  assert.equal(first.length,1);
  const [{id,token}]=first;
  assert.equal(await scheduleExternalAlertReceiverRetry(
   db,scope,id,token,300000),'scheduled');
  assert.equal(await scheduleExternalAlertReceiverRetry(
   db,'prod-kz',id,token,1000),'stale');
  assert.equal(await scheduleExternalAlertReceiverRetry(
   db,scope,id,randomUUID(),1000),'stale');
  const before=await db.query<{next_attempt_at:Date}>(`
   SELECT next_attempt_at FROM notification_alert_receiver_retry_schedule
   WHERE ingress_id=$1
  `,[id]);
  assert.equal(before.rows.length,1);
  await db.query(`
   UPDATE notification_alert_receiver_ingress
   SET lease_expires_at=clock_timestamp()-interval '1 second'
   WHERE id=$1`,[id]);
  assert.deepEqual(await claimExternalAlertReceiverIngress(db,scope,1,5000),[]);
  assert.equal(await scheduleExternalAlertReceiverRetry(
   db,scope,id,token,1000),'stale');
  const after=await db.query<{next_attempt_at:Date}>(`
   SELECT next_attempt_at FROM notification_alert_receiver_retry_schedule
   WHERE ingress_id=$1
  `,[id]);
  assert.equal(after.rows[0].next_attempt_at.getTime(),
   before.rows[0].next_attempt_at.getTime());
  await db.query(`
   UPDATE notification_alert_receiver_retry_schedule
   SET next_attempt_at=clock_timestamp()-interval '1 second'
   WHERE ingress_id=$1`,[id]);
  const retry=await claimExternalAlertReceiverIngress(db,scope,1,5000);
  assert.equal(retry.length,1);
  assert.equal(retry[0].id,id);
  assert.notEqual(retry[0].token,token);
 }finally{
  await db.query('ROLLBACK').catch(()=>{});
  await db.end();
 }
});

test('retry scheduling SQL response fails closed',async()=>{
 const db={query:async()=>({rows:[{},{}]})} as never;
 await assert.rejects(scheduleExternalAlertReceiverRetry(
  db,'staging-kz',randomUUID(),randomUUID(),1000),
  /invalid_external_alert_receiver_database/);
});
