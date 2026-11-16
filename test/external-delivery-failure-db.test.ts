import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Client} from 'pg';
import {recordExternalDeliveryFailure}
 from '../src/modules/notifications/external-delivery-failure.js';

test('external failure persists retry schedule, then terminal failure, without PII',async()=>{
 const db=new Client({connectionString:process.env.DATABASE_URL});
 await db.connect();
 await db.query('BEGIN');
 const event=randomUUID(),intent=randomUUID(),delivery=randomUUID();
 const contact=randomUUID();
 const now=new Date('2026-11-16T10:00:00.000Z');
 try{
  await db.query(`INSERT INTO guest_contacts
   (id,channel,encrypted_value,digest,expires_at)
   VALUES($1,'email','encrypted-test',$2,now()+interval '1 day')`,
   [contact,'external-retry:'+randomUUID()]);
  await db.query(`INSERT INTO domain_outbox_events
   (id,topic,subject_kind,subject_id,safe_payload)
   VALUES($1,'test.external.retry','ServiceRequest',$2,'{}'::jsonb)`,
   [event,randomUUID()]);
  await db.query(`INSERT INTO notification_intents
   (id,domain_event_id,guest_contact_id,audience,channel,dedupe_key)
   VALUES($1,$2,$3,'CLIENT','EMAIL',$4)`,
   [intent,event,contact,'external-retry:'+randomUUID()]);
  await db.query(`INSERT INTO notification_deliveries
   (id,intent_id,channel) VALUES($1,$2,'EMAIL')`,[delivery,intent]);

  const first=await recordExternalDeliveryFailure(db,delivery,now,2);
  assert.deepEqual(first,{state:'PENDING',attempts:1,nextAttemptAt:new Date(now.getTime()+30_000)});
  assert.equal(await recordExternalDeliveryFailure(db,delivery,new Date(now.getTime()+29_999),2),null);
  const second=await recordExternalDeliveryFailure(db,delivery,new Date(now.getTime()+30_000),2);
  assert.deepEqual(second,{state:'FAILED',attempts:2,nextAttemptAt:null});
  assert.equal(await recordExternalDeliveryFailure(db,delivery,now,2),null);
  const rows=await db.query<{state:string;attempt_count:number;next_attempt_at:Date|null}>(`
   SELECT state,attempt_count,next_attempt_at FROM notification_deliveries WHERE id=$1`,[delivery]);
  assert.deepEqual(rows.rows,[{state:'FAILED',attempt_count:2,next_attempt_at:null}]);
  const intents=await db.query<{state:string;attempts:number;next_attempt_at:Date|null}>(`
   SELECT state,attempts,next_attempt_at FROM notification_intents WHERE id=$1`,[intent]);
  assert.deepEqual(intents.rows,[{state:'FAILED',attempts:2,next_attempt_at:null}]);
  assert.equal(await recordExternalDeliveryFailure(db,randomUUID(),now),null);
 }finally{
  await db.query('ROLLBACK').catch(()=>{});
  await db.end();
 }
});

test('external failure rejects unsafe inputs without issuing SQL',async()=>{
 let queries=0;
 const client={query:async()=>{queries++;throw Error('unexpected SQL');}};
 for(const id of ['', 'bad', '00000000-0000-0000-0000-000000000000']){
  await assert.rejects(recordExternalDeliveryFailure(client as never,id,new Date()),/invalid_notification_delivery_id/);
 }
 await assert.rejects(recordExternalDeliveryFailure(client as never,randomUUID(),new Date(NaN)),RangeError);
 await assert.rejects(recordExternalDeliveryFailure(client as never,randomUUID(),new Date(),0),RangeError);
 assert.equal(queries,0);
});

test('external failure ignores non-external or terminal delivery without modifying rows',async()=>{
 let calls=0;
 const client={query:async()=>{calls++;return {rows:[]};}};
 assert.equal(await recordExternalDeliveryFailure(client as never,randomUUID(),new Date()),null);
 assert.equal(calls,1);
 const stale={query:async()=>{calls++;return {rows:[{
  id:randomUUID(),intent_id:randomUUID(),channel:'EMAIL',
  state:'DELIVERED',intent_state:'DELIVERED',attempt_count:1,
 }]};}};
 assert.equal(await recordExternalDeliveryFailure(stale as never,randomUUID(),new Date()),null);
 assert.equal(calls,2);
});
