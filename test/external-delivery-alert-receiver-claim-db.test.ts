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

test('receiver claims reject unbounded or invalid worker parameters before SQL',async()=>{
 let queries=0;
 const db={query:async()=>{queries++;throw new Error('unexpected SQL');}} as never;
 for(const [scope,limit,ms] of [
  ['INVALID',1,5000],['staging-kz',0,5000],
  ['staging-kz',26,5000],['staging-kz',1,4999],
  ['staging-kz',1,300001],['staging-kz',1.5,5000],
 ] as const){
  await assert.rejects(claimExternalAlertReceiverIngress(db,scope,limit,ms),
   /invalid_external_alert_receiver_lease/);
 }
 assert.equal(queries,0);
});

test('PostgreSQL receiver claim is unique until expiry and scope-bound',async()=>{
 const db=new Client({connectionString:process.env.DATABASE_URL});
 await db.connect();
 await db.query('BEGIN');
 const scope='staging-'+randomUUID().replaceAll('-','').slice(0,18);
 const key='services-alert-v2-'+'a'.repeat(64);
 try{
  await acceptExternalDeliveryAlertIngress(db,scope,key,[{
   code:'DUE_BACKLOG',severity:'warning',observed:3,threshold:2,
  }]);
  assert.deepEqual(await claimExternalAlertReceiverIngress(
   db,'prod-'+randomUUID().replaceAll('-','').slice(0,18),1,5000),[]);
  const first=await claimExternalAlertReceiverIngress(db,scope,1,5000);
  assert.equal(first.length,1);
  assert.match(first[0].id,/^[a-f0-9-]{36}$/);
  assert.match(first[0].token,/^[a-f0-9-]{36}$/);
  assert.deepEqual(first[0].alerts,[{
   code:'DUE_BACKLOG',severity:'warning',observed:3,threshold:2,
  }]);
  assert.deepEqual(await claimExternalAlertReceiverIngress(db,scope,1,5000),[]);
  await db.query(`
   UPDATE notification_alert_receiver_ingress
   SET lease_expires_at=clock_timestamp()-interval '1 second'
   WHERE id=$1`,[first[0].id]);
  const second=await claimExternalAlertReceiverIngress(db,scope,1,5000);
  assert.equal(second.length,1);
  assert.equal(second[0].id,first[0].id);
  assert.notEqual(second[0].token,first[0].token);
  assert.equal(await acknowledgeClaimedExternalAlertReceiverIngress(
   db,scope,first[0].id,first[0].token),'stale');
  assert.equal(await acknowledgeClaimedExternalAlertReceiverIngress(
   db,'prod-kz',second[0].id,second[0].token),'stale');
  assert.equal(await acknowledgeClaimedExternalAlertReceiverIngress(
   db,scope,second[0].id,second[0].token),'acknowledged');
  assert.equal(await acknowledgeClaimedExternalAlertReceiverIngress(
   db,scope,second[0].id,second[0].token),'stale');
  const current=await db.query<{claim_count:number;state:string}>(`
   SELECT claim_count,state FROM notification_alert_receiver_ingress WHERE id=$1
  `,[first[0].id]);
  assert.equal(current.rows[0].claim_count,2);
  assert.equal(current.rows[0].state,'ACKED');
  await db.query('SAVEPOINT forbidden_payload');
  await assert.rejects(db.query(`
    UPDATE notification_alert_receiver_ingress SET body_digest=$2 WHERE id=$1
  `,[first[0].id,'b'.repeat(64)]),/immutable/);
  await db.query('ROLLBACK TO SAVEPOINT forbidden_payload');
 }finally{
  await db.query('ROLLBACK').catch(()=>{});
  await db.end();
 }
});

test('receiver claim rejects accessor-backed driver rows',async()=>{
 let reads=0;
 const row=Object.defineProperty({id:randomUUID(),alerts:[{}]},'lease_token',{
  get(){reads++;throw new Error('unsafe getter');},
 });
 const db={query:async()=>({rows:[row]})} as never;
 await assert.rejects(claimExternalAlertReceiverIngress(
  db,'staging-kz',1,5000),/invalid_external_alert_receiver_database/);
 assert.equal(reads,0);
});
