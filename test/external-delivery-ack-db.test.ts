import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Client} from 'pg';
import {acknowledgeClaimedExternalDeliverySent}
 from '../src/modules/notifications/external-delivery-ack.js';

test('provider acceptance requires the current lease and updates intent and delivery once',async()=>{
 const db=new Client({connectionString:process.env.DATABASE_URL});
 await db.connect();
 await db.query('BEGIN');
 const event=randomUUID(),intent=randomUUID(),delivery=randomUUID(),contact=randomUUID();
 const lease=randomUUID(),replaced=randomUUID();
 try{
  await db.query(`INSERT INTO guest_contacts
   (id,channel,encrypted_value,digest,expires_at)
   VALUES($1,'email','encrypted-test',$2,now()+interval '1 day')`,
   [contact,'accepted:'+randomUUID()]);
  await db.query(`INSERT INTO domain_outbox_events
   (id,topic,subject_kind,subject_id,safe_payload)
   VALUES($1,'test.external.accepted','ServiceRequest',$2,'{}'::jsonb)`,
   [event,randomUUID()]);
  await db.query(`INSERT INTO notification_intents
   (id,domain_event_id,guest_contact_id,audience,channel,dedupe_key)
   VALUES($1,$2,$3,'CLIENT','EMAIL',$4)`,
   [intent,event,contact,'accepted:'+randomUUID()]);
  await db.query(`INSERT INTO notification_deliveries
   (id,intent_id,channel,lease_token,lease_expires_at)
   VALUES($1,$2,'EMAIL',$3,now()+interval '2 minutes')`,
   [delivery,intent,lease]);

  assert.equal(await acknowledgeClaimedExternalDeliverySent(db,delivery,randomUUID()),null);

  // Once the lease has changed, the previous worker can no longer acknowledge.
  await db.query('UPDATE notification_deliveries SET lease_token=$2 WHERE id=$1',[delivery,replaced]);
  assert.equal(await acknowledgeClaimedExternalDeliverySent(db,delivery,lease),null);

  // The current token is also rejected after lease expiry.
  await db.query(`UPDATE notification_deliveries
   SET lease_expires_at=now()-interval '1 second' WHERE id=$1`,[delivery]);
  assert.equal(await acknowledgeClaimedExternalDeliverySent(db,delivery,replaced),null);
  await db.query(`UPDATE notification_deliveries
   SET lease_expires_at=now()+interval '2 minutes' WHERE id=$1`,[delivery]);

  // Contradictory persisted counters fail closed and do not mutate the delivery.
  await db.query('UPDATE notification_intents SET attempts=3 WHERE id=$1',[intent]);
  await assert.rejects(acknowledgeClaimedExternalDeliverySent(db,delivery,replaced),
   /notification_attempt_counter_mismatch/);
  await db.query('UPDATE notification_intents SET attempts=0 WHERE id=$1',[intent]);

  // A provider acceptance cannot silently heal a contradictory durable
  // retry schedule. Test both directions before the normal SENT transition.
  await db.query(`UPDATE notification_intents SET next_attempt_at=now()-interval '1 minute'
    WHERE id=$1`,[intent]);
  await assert.rejects(acknowledgeClaimedExternalDeliverySent(db,delivery,replaced),
   /notification_retry_schedule_mismatch/);
  await db.query(`UPDATE notification_intents SET next_attempt_at=NULL WHERE id=$1`,
   [intent]);
  await db.query(`UPDATE notification_deliveries SET next_attempt_at=now()-interval '1 minute'
    WHERE id=$1`,[delivery]);
  await assert.rejects(acknowledgeClaimedExternalDeliverySent(db,delivery,replaced),
   /notification_retry_schedule_mismatch/);
  await db.query(`UPDATE notification_deliveries SET next_attempt_at=NULL WHERE id=$1`,
   [delivery]);
  const stillPending=await db.query<{state:string;attempt_count:number}>(`
   SELECT state,attempt_count FROM notification_deliveries WHERE id=$1`,[delivery]);
  assert.deepEqual(stillPending.rows,[{state:'PENDING',attempt_count:0}]);

  assert.deepEqual(await acknowledgeClaimedExternalDeliverySent(db,delivery,replaced),
   {intentId:intent,attempts:1});
  assert.equal(await acknowledgeClaimedExternalDeliverySent(db,delivery,replaced),null);
  const rows=await db.query<{
   state:string;attempt_count:number;lease_token:string|null;
   lease_expires_at:Date|null;delivered_at:Date|null;
  }>(`SELECT state,attempt_count,lease_token,lease_expires_at,delivered_at
   FROM notification_deliveries WHERE id=$1`,[delivery]);
  assert.deepEqual(rows.rows,[{
   state:'SENT',attempt_count:1,lease_token:null,lease_expires_at:null,delivered_at:null,
  }]);
  const intents=await db.query<{state:string;attempts:number;next_attempt_at:Date|null}>(`
   SELECT state,attempts,next_attempt_at FROM notification_intents WHERE id=$1`,[intent]);
  assert.deepEqual(intents.rows,[{state:'SENT',attempts:1,next_attempt_at:null}]);
 }finally{
  await db.query('ROLLBACK').catch(()=>{});
  await db.end();
 }
});

test('provider acknowledgement rejects invalid proof without database access',async()=>{
 let calls=0;
 const client={query:async()=>{calls++;throw new Error('unexpected SQL');}};
 for(const [delivery,token] of [
  ['bad',randomUUID()],[randomUUID(),'bad'],['00000000-0000-0000-0000-000000000000',randomUUID()],
 ]){
  await assert.rejects(acknowledgeClaimedExternalDeliverySent(client as never,delivery,token),
   /invalid_external_delivery_claim_proof/);
 }
 assert.equal(calls,0);
});
