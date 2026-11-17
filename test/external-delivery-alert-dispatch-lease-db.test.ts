import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Client} from 'pg';
import {claimExternalAlertEvent,acknowledgeExternalAlertEvent}
 from '../src/modules/notifications/external-delivery-alert-dispatch-lease.js';

test('PostgreSQL fenced claim, stale-lease rejection and durable ACK',async()=>{
 const db=new Client({connectionString:process.env.DATABASE_URL});
 await db.connect();
 await db.query('BEGIN');
 try{
  await db.query(`INSERT INTO notification_alert_states(code)
   VALUES('DUE_BACKLOG') ON CONFLICT (code) DO NOTHING`);
  // Lock state only for this test's generation selection, then rollback.
  await db.query(`SELECT code FROM notification_alert_states
   WHERE code='DUE_BACKLOG' FOR UPDATE`);
  await db.query(`INSERT INTO notification_alert_events
   (code,generation,observed,threshold,severity)
   SELECT 'DUE_BACKLOG',coalesce(max(generation),0)+1,3,2,'warning'
   FROM notification_alert_events WHERE code='DUE_BACKLOG'`);
  const first=await claimExternalAlertEvent(db,30);
  assert.ok(first);
  assert.equal(typeof first.leaseToken,'string');
  assert.match(first.eventId,/^[0-9a-f-]{36}$/);
  assert.match(first.generation,/^[0-9]+$/);
  assert.equal(JSON.stringify(first).includes('private-contact'),false);

  const second=await claimExternalAlertEvent(db,30);
  assert.equal(second,null);
  assert.equal(await acknowledgeExternalAlertEvent(
   db,first.eventId,'00000000-0000-4000-8000-000000000000'),false);
  await db.query(`UPDATE notification_alert_dispatches
   SET lease_expires_at=clock_timestamp()-interval '1 second'
   WHERE event_id=$1`,[first.eventId]);
  assert.equal(await acknowledgeExternalAlertEvent(
   db,first.eventId,first.leaseToken),false);
  const reclaim=await claimExternalAlertEvent(db,30);
  assert.ok(reclaim);
  assert.equal(reclaim.eventId,first.eventId);
  assert.notEqual(reclaim.leaseToken,first.leaseToken);
  assert.equal(await acknowledgeExternalAlertEvent(
   db,first.eventId,first.leaseToken),false);
  assert.equal(await acknowledgeExternalAlertEvent(
   db,reclaim.eventId,reclaim.leaseToken),true);
  assert.equal(await acknowledgeExternalAlertEvent(
   db,reclaim.eventId,reclaim.leaseToken),false);
  assert.equal(await claimExternalAlertEvent(db,30),null);
  const count=await db.query<{attempt_count:number;delivered_at:Date|null}>(`
   SELECT attempt_count,delivered_at FROM notification_alert_dispatches
   WHERE event_id=$1`,[first.eventId]);
  assert.equal(count.rows[0].attempt_count,2);
  assert.ok(count.rows[0].delivered_at);
 }finally{
  await db.query('ROLLBACK').catch(()=>{});
  await db.end();
 }
});

test('invalid leases and malformed tokens reject before SQL',async()=>{
 let sql=0;
 const db={query:async()=>{sql++;return {rows:[]};}};
 for(const seconds of [0,29,301,1.2,NaN,Infinity]){
  await assert.rejects(claimExternalAlertEvent(db as never,seconds),
   /invalid_external_alert_dispatch_claim/);
 }
 for(const [id,token] of [
  ['bad','00000000-0000-4000-8000-000000000000'],
  ['00000000-0000-4000-8000-000000000000','bad'],
 ]){
  await assert.rejects(acknowledgeExternalAlertEvent(
   db as never,id,token),/invalid_external_alert_dispatch_ack/);
 }
 assert.equal(sql,0);
});

test('malformed driver claim rows reject without executing getters',async()=>{
 let reads=0;
 const forged=Object.defineProperty({
  event_id:'00000000-0000-4000-8000-000000000001',
  code:'DUE_BACKLOG',generation:'1',observed:'3',
  threshold:'2',severity:'warning',
 },'code',{get(){reads++;throw new Error('unsafe claim getter');}});
 for(const response of [
  {rows:[forged]},
  {rows:null},
  Object.defineProperty({},'rows',{get(){reads++;throw Error('unsafe rows getter');}}),
  {rows:[null]},
 ]) {
  let queries=0;
  const db={query:async()=>++queries===1?{rows:[]}:response};
  await assert.rejects(claimExternalAlertEvent(db as never,30),
   /invalid_external_alert_dispatch_(row|result)/);
  assert.equal(queries,2);
 }
 assert.equal(reads,0);
});

test('malformed ACK response cannot be mistaken for delivery success',async()=>{
 const eventId='00000000-0000-4000-8000-000000000001';
 const token='00000000-0000-4000-8000-000000000002';
 let getters=0;
 const forged=Object.defineProperty({},'event_id',{
  get(){getters++;throw Error('unsafe ack getter');},
 });
 for(const response of [
  {rows:[{event_id:'00000000-0000-4000-8000-000000000003'}]},
  {rows:[forged]}, {rows:null}, {rows:[null]},
  {rows:[{event_id:eventId},{event_id:eventId}]},
 ]) {
  let calls=0;
  const db={query:async()=>{calls++;return response;}};
  await assert.rejects(
   acknowledgeExternalAlertEvent(db as never,eventId,token),
   /invalid_external_alert_dispatch_(ack_result|result)/);
  assert.equal(calls,1);
 }
 assert.equal(getters,0);
});
