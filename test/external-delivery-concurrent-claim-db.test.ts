import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Client} from 'pg';
import {claimExternalDelivery,failClaimedExternalDelivery}
 from '../src/modules/notifications/external-delivery-lease.js';
import {acknowledgeClaimedExternalDeliverySent}
 from '../src/modules/notifications/external-delivery-ack.js';

test('concurrent PostgreSQL workers skip a locked claim, respect lease and fence stale completion',async()=>{
 const writer=new Client({connectionString:process.env.DATABASE_URL});
 const competing=new Client({connectionString:process.env.DATABASE_URL});
 const observer=new Client({connectionString:process.env.DATABASE_URL});
 await Promise.all([writer.connect(),competing.connect(),observer.connect()]);
 const contact=randomUUID(),event=randomUUID(),intent=randomUUID(),delivery=randomUUID();
 try{
  await writer.query(`INSERT INTO guest_contacts
   (id,channel,encrypted_value,digest,expires_at)
   VALUES($1,'email','encrypted-concurrency-fixture',$2,now()+interval '1 day')`,
   [contact,'claim-concurrent:'+randomUUID()]);
  await writer.query(`INSERT INTO domain_outbox_events
   (id,topic,subject_kind,subject_id,safe_payload)
   VALUES($1,'test.external.concurrent','ServiceRequest',$2,'{}'::jsonb)`,
   [event,randomUUID()]);
  await writer.query(`INSERT INTO notification_intents
   (id,domain_event_id,guest_contact_id,audience,channel,dedupe_key)
   VALUES($1,$2,$3,'CLIENT','EMAIL',$4)`,
   [intent,event,contact,'claim-concurrent:'+randomUUID()]);
  await writer.query(`INSERT INTO notification_deliveries
   (id,intent_id,channel) VALUES($1,$2,'EMAIL')`,[delivery,intent]);

  await writer.query('BEGIN');
  const first=await claimExternalDelivery(writer,90);
  assert.equal(first?.deliveryId,delivery);
  // Writer has not committed its lease yet. A different worker must skip the
  // row without waiting or receiving an alternative copy of the same work.
  await competing.query('BEGIN');
  await competing.query("SET LOCAL lock_timeout = '2s'");
  assert.equal(await claimExternalDelivery(competing,90),null);
  await competing.query('COMMIT');
  await writer.query('COMMIT');
  const visible=await observer.query<{lease_token:string;lease_expires_at:Date}>(`
   SELECT lease_token::text,lease_expires_at FROM notification_deliveries
   WHERE id=$1`,[delivery]);
  assert.equal(visible.rows[0]?.lease_token,first?.leaseToken);
  assert.equal(await claimExternalDelivery(competing,90),null);

  // A different worker may reclaim after lease expiry; the former worker
  // cannot acknowledge/fail with the stale fencing proof.
  await observer.query(`UPDATE notification_deliveries
    SET lease_expires_at=now()-interval '1 second' WHERE id=$1`,[delivery]);
  await competing.query('BEGIN');
  const second=await claimExternalDelivery(competing,90);
  assert.equal(second?.deliveryId,delivery);
  assert.notEqual(second?.leaseToken,first?.leaseToken);
  await competing.query('COMMIT');
  assert.equal(await acknowledgeClaimedExternalDeliverySent(
   writer,delivery,first!.leaseToken),null);
  assert.equal(await failClaimedExternalDelivery(
   writer,delivery,first!.leaseToken,new Date()),null);
  await writer.query('BEGIN');
  assert.deepEqual(await acknowledgeClaimedExternalDeliverySent(
   writer,delivery,second!.leaseToken),{intentId:intent,attempts:1});
  await writer.query('COMMIT');

  const state=await observer.query<{
   delivery_state:string;intent_state:string;
   attempts:number;attempt_count:number;
   lease_token:string|null;
  }>(`SELECT d.state AS delivery_state,n.state AS intent_state,
      n.attempts,d.attempt_count,d.lease_token::text
    FROM notification_deliveries d
    JOIN notification_intents n ON n.id=d.intent_id WHERE d.id=$1`,[delivery]);
  assert.deepEqual(state.rows,[{
   delivery_state:'SENT',intent_state:'SENT',
   attempts:1,attempt_count:1,lease_token:null,
  }]);
  assert.equal(await claimExternalDelivery(competing,90),null);
 }finally{
  await writer.query('ROLLBACK').catch(()=>{});
  await competing.query('ROLLBACK').catch(()=>{});
  await observer.query('DELETE FROM notification_deliveries WHERE id=$1',[delivery]).catch(()=>{});
  await observer.query('DELETE FROM notification_intents WHERE id=$1',[intent]).catch(()=>{});
  await observer.query('DELETE FROM domain_outbox_events WHERE id=$1',[event]).catch(()=>{});
  await observer.query('DELETE FROM guest_contacts WHERE id=$1',[contact]).catch(()=>{});
  await Promise.all([writer.end(),competing.end(),observer.end()]);
 }
});
