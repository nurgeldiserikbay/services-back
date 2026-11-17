import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Client} from 'pg';
import {acceptExternalDeliveryAlertIngress}
 from '../src/modules/notifications/external-delivery-alert-receiver-ingress.js';
import {acknowledgeExternalAlertReceiverIngress}
 from '../src/modules/notifications/external-delivery-alert-receiver-ack.js';

test('receiver ACK rejects invalid identity and scope before SQL',async()=>{
 let calls=0;
 const db={query:async()=>{calls++;throw new Error('unsafe SQL');}} as never;
 for(const [scope,id] of [
  ['INVALID',randomUUID()],['staging-kz','not-a-uuid'],
  ['',randomUUID()],['staging-kz',randomUUID().toUpperCase()],
 ]){
  await assert.rejects(acknowledgeExternalAlertReceiverIngress(
   db,scope,id),/invalid_external_alert_receiver_ack/);
 }
 assert.equal(calls,0);
});

test('receiver ACK is scope-bound and idempotent in PostgreSQL',async()=>{
 const db=new Client({connectionString:process.env.DATABASE_URL});
 await db.connect();
 await db.query('BEGIN');
 const scope='staging-'+randomUUID().replaceAll('-','').slice(0,18);
 const otherScope='prod-'+randomUUID().replaceAll('-','').slice(0,18);
 const key='services-alert-v2-'+'e'.repeat(64);
 try{
  await acceptExternalDeliveryAlertIngress(db,scope,key,[{
   code:'DUE_BACKLOG',severity:'warning',observed:2,threshold:2,
  }]);
  const found=await db.query<{id:string;state:string}>(`
   SELECT id,state FROM notification_alert_receiver_ingress
   WHERE receiver_scope=$1 AND idempotency_key=$2
  `,[scope,key]);
  assert.equal(found.rows.length,1);
  const id=found.rows[0].id;
  assert.equal(found.rows[0].state,'PENDING');
  assert.equal(await acknowledgeExternalAlertReceiverIngress(
   db,otherScope,id),'not_found');
  assert.equal(await acknowledgeExternalAlertReceiverIngress(
   db,scope,id),'acknowledged');
  assert.equal(await acknowledgeExternalAlertReceiverIngress(
   db,scope,id),'already_acked');
  assert.equal(await acknowledgeExternalAlertReceiverIngress(
   db,scope,randomUUID()),'not_found');
  const rows=await db.query<{state:string;body_digest:string}>(`
   SELECT state,body_digest FROM notification_alert_receiver_ingress
   WHERE id=$1
  `,[id]);
  assert.equal(rows.rows[0].state,'ACKED');
  assert.match(rows.rows[0].body_digest,/^[a-f0-9]{64}$/);
 }finally{
  await db.query('ROLLBACK').catch(()=>{});
  await db.end();
 }
});

test('receiver ACK refuses accessor-backed or unexpected database states',async()=>{
 const id=randomUUID();
 let reads=0;
 const row=Object.defineProperty({},'state',{
  get(){reads++;throw new Error('getter executed');},
 });
 for(const value of [row,{state:'PENDING'},{state:'INVALID'},null]){
  let queries=0;
  const db={query:async()=>{
   queries++;
   return queries===1?{rows:[]}:{rows:[value]};
  }} as never;
  await assert.rejects(acknowledgeExternalAlertReceiverIngress(
   db,'staging-kz',id),/invalid_external_alert_receiver_database/);
  assert.equal(queries,2);
 }
 assert.equal(reads,0);
});
