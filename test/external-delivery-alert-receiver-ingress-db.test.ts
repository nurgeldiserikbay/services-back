import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Client} from 'pg';
import {acceptExternalDeliveryAlertIngress}
 from '../src/modules/notifications/external-delivery-alert-receiver-ingress.js';

const scope='staging-kz';
const key='services-alert-v2-'+'a'.repeat(64);
const backlog={
 code:'DUE_BACKLOG',severity:'warning',observed:3,threshold:2,
} as const;
const expired={
 code:'EXPIRED_LEASES',severity:'warning',observed:1,threshold:1,
} as const;

test('receiver ingress validates scope, key and canonical alert data before SQL',async()=>{
 let queries=0,reads=0;
 const db={query:async()=>{queries++;throw new Error('no query expected');}} as never;
 const unsafe=Object.defineProperty({...backlog},'observed',{
  get(){reads++;throw new Error('accessor invoked');},
 });
 for(const values of [
  {scope:'PROD',key,alerts:[backlog]},
  {scope,key:'invalid',alerts:[backlog]},
  {scope,key,alerts:[]},
  {scope,key,alerts:[backlog,backlog]},
  {scope,key,alerts:[{...backlog,observed:1}]},
  {scope,key,alerts:[{...backlog,secret:'private'}]},
  {scope,key,alerts:[unsafe]},
 ]){
  await assert.rejects(acceptExternalDeliveryAlertIngress(
   db,values.scope,values.key,values.alerts as never),
   /invalid_external_alert_receiver_input/);
 }
 assert.equal(queries,0);
 assert.equal(reads,0);
});

test('PostgreSQL receiver ingress accepts once, preserves replay and rejects key conflicts',async()=>{
 const db=new Client({connectionString:process.env.DATABASE_URL});
 await db.connect();
 await db.query('BEGIN');
 const receiverScope='staging-'+randomUUID().replaceAll('-','').slice(0,18);
 const receiverKey='services-alert-v2-'+'b'.repeat(64);
 try{
  assert.equal(await acceptExternalDeliveryAlertIngress(
   db,receiverScope,receiverKey,[backlog,expired]),'accepted');
  assert.equal(await acceptExternalDeliveryAlertIngress(
   db,receiverScope,receiverKey,[expired,backlog]),'duplicate');
  const row=await db.query<{
   id:string;state:string;body_digest:string;alerts:unknown;
  }>(`SELECT id,state,body_digest,alerts
      FROM notification_alert_receiver_ingress
      WHERE receiver_scope=$1 AND idempotency_key=$2`,
   [receiverScope,receiverKey]);
  assert.equal(row.rows.length,1);
  assert.equal(row.rows[0].state,'PENDING');
  assert.match(row.rows[0].body_digest,/^[a-f0-9]{64}$/);
  assert.deepEqual(row.rows[0].alerts,[backlog,expired]);
  assert.equal(JSON.stringify(row.rows[0]).includes('Authorization'),false);
  await assert.rejects(acceptExternalDeliveryAlertIngress(
   db,receiverScope,receiverKey,[{...backlog,observed:5}]),
  /external_alert_receiver_idempotency_conflict/);
  const secondKey='services-alert-v2-'+'c'.repeat(64);
  assert.equal(await acceptExternalDeliveryAlertIngress(
   db,receiverScope,secondKey,[backlog]),'accepted');
  const differentScope='prod-'+randomUUID().replaceAll('-','').slice(0,18);
  assert.equal(await acceptExternalDeliveryAlertIngress(
   db,differentScope,receiverKey,[backlog]),'accepted');
  await db.query('SAVEPOINT mutation_guard');
  await assert.rejects(db.query(
   `UPDATE notification_alert_receiver_ingress SET body_digest=$2
    WHERE id=$1`,[row.rows[0].id,'d'.repeat(64)]),/immutable/);
  await db.query('ROLLBACK TO SAVEPOINT mutation_guard');
  await db.query(`UPDATE notification_alert_receiver_ingress
    SET state='ACKED' WHERE id=$1`,[row.rows[0].id]);
  await db.query('SAVEPOINT second_ack');
  await assert.rejects(db.query(`UPDATE notification_alert_receiver_ingress
    SET state='ACKED' WHERE id=$1`,[row.rows[0].id]),/immutable/);
  await db.query('ROLLBACK TO SAVEPOINT second_ack');
 }finally{
  await db.query('ROLLBACK').catch(()=>{});
  await db.end();
 }
});

test('malformed existing digest fails closed without treating it as duplicate',async()=>{
 let calls=0;
 const client={query:async()=>{
  calls++;
  return calls===1?{rows:[]}:{rows:[{body_digest:'invalid'}]};
 }} as never;
 await assert.rejects(acceptExternalDeliveryAlertIngress(
  client,scope,key,[backlog]),/external_alert_receiver_idempotency_conflict/);
 assert.equal(calls,2);
});
