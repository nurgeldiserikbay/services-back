import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Client} from 'pg';
import {listFailedExternalDeliveries}
 from '../src/modules/notifications/dead-letter-inventory.js';

test('failed external notification inventory exposes only consistent terminal metadata',async()=>{
 const db=new Client({connectionString:process.env.DATABASE_URL});
 await db.connect();
 await db.query('BEGIN');
 const contact=randomUUID(),event=randomUUID(),intent=randomUUID(),delivery=randomUUID();
 try{
  await db.query(`INSERT INTO guest_contacts
   (id,channel,encrypted_value,digest,expires_at)
   VALUES($1,'email','encrypted-private-fixture',$2,now()+interval '1 day')`,
   [contact,'dlq-inventory:'+randomUUID()]);
  await db.query(`INSERT INTO domain_outbox_events
   (id,topic,subject_kind,subject_id,safe_payload)
   VALUES($1,'test.dead-letter','ServiceRequest',$2,'{}'::jsonb)`,
   [event,randomUUID()]);
  await db.query(`INSERT INTO notification_intents
   (id,domain_event_id,guest_contact_id,audience,channel,state,attempts,dedupe_key)
   VALUES($1,$2,$3,'CLIENT','EMAIL','FAILED',5,$4)`,
   [intent,event,contact,'dlq-inventory:'+randomUUID()]);
  await db.query(`INSERT INTO notification_deliveries
   (id,intent_id,channel,state,attempt_count)
   VALUES($1,$2,'EMAIL','FAILED',5)`,[delivery,intent]);

  const rows=await listFailedExternalDeliveries(db,50);
  const target=rows.find(x=>x.deliveryId===delivery);
  assert.deepEqual(target,{deliveryId:delivery,intentId:intent,channel:'EMAIL',attempts:5});
  assert.equal(JSON.stringify(target).includes('encrypted-private-fixture'),false);
  assert.deepEqual((await listFailedExternalDeliveries(db,50,delivery))
   .filter(x=>x.deliveryId===delivery),[]);

  // Fail closed: corrupted counters and stale leases are excluded.
  await db.query('UPDATE notification_intents SET attempts=4 WHERE id=$1',[intent]);
  assert.equal((await listFailedExternalDeliveries(db,50))
   .some(x=>x.deliveryId===delivery),false);
  await db.query('UPDATE notification_intents SET attempts=5 WHERE id=$1',[intent]);
  await db.query(`UPDATE notification_deliveries
   SET lease_token=$2,lease_expires_at=now()+interval '1 minute'
   WHERE id=$1`,[delivery,randomUUID()]);
  assert.equal((await listFailedExternalDeliveries(db,50))
   .some(x=>x.deliveryId===delivery),false);
 }finally{
  await db.query('ROLLBACK').catch(()=>{});
  await db.end();
 }
});

test('dead-letter inventory rejects unsafe paging input before SQL',async()=>{
 let calls=0;
 const fake={query:async()=>{calls++;throw new Error('unexpected SQL');}};
 for(const limit of [0,-1,51,1.5,NaN,Infinity]){
  await assert.rejects(listFailedExternalDeliveries(fake as never,limit),RangeError);
 }
 await assert.rejects(listFailedExternalDeliveries(fake as never,10,'bad'),
  /invalid_dead_letter_cursor/);
 assert.equal(calls,0);
});

test('dead-letter inventory rejects duplicate, unsorted and stale-cursor rows',async()=>{
 const lower='11111111-1111-4111-8111-111111111111';
 const higher='22222222-2222-4222-8222-222222222222';
 const intent=randomUUID();
 const row=(delivery_id:string)=>({
  delivery_id,intent_id:intent,channel:'EMAIL',attempt_count:3,
 });
 for(const rows of [[row(lower),row(lower)],
  [row(higher),row(lower)]]){
  const fake={query:async()=>({rows})};
  await assert.rejects(listFailedExternalDeliveries(fake as never,10),
   /invalid_dead_letter_inventory/);
 }
 const fake={query:async()=>({rows:[row(lower)]})};
 await assert.rejects(listFailedExternalDeliveries(fake as never,10,lower),
  /invalid_dead_letter_inventory/);
 await assert.rejects(listFailedExternalDeliveries(fake as never,10,higher),
  /invalid_dead_letter_inventory/);
});

test('dead-letter inventory accepts increasing UUIDs after uppercase cursor',async()=>{
 const lower='11111111-1111-4111-8111-111111111111';
 const higher='22222222-2222-4222-8222-222222222222';
 const intent=randomUUID();
 const fake={query:async()=>({rows:[{
  delivery_id:higher,intent_id:intent,channel:'SMS',attempt_count:2,
 }]})};
 assert.deepEqual(await listFailedExternalDeliveries(fake as never,10,
  lower.toUpperCase()),[{
  deliveryId:higher,intentId:intent,channel:'SMS',attempts:2,
 }]);
});
