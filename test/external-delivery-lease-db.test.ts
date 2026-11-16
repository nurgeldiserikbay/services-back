import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Client} from 'pg';
import {claimExternalDelivery,failClaimedExternalDelivery}
 from '../src/modules/notifications/external-delivery-lease.js';

test('fenced external claim excludes active lease and rejects stale acknowledgement',async()=>{
 const db=new Client({connectionString:process.env.DATABASE_URL});
 const second=new Client({connectionString:process.env.DATABASE_URL});
 await db.connect();
 await second.connect();
 // Dedicated fixture with unique event/recipient; clean it after each assertion.
 const event=randomUUID(),intent=randomUUID(),delivery=randomUUID(),contact=randomUUID();
 try{
  await db.query(`INSERT INTO guest_contacts
   (id,channel,encrypted_value,digest,expires_at)
   VALUES($1,'email','encrypted-test',$2,now()+interval '1 day')`,
   [contact,'lease:'+randomUUID()]);
  await db.query(`INSERT INTO domain_outbox_events
   (id,topic,subject_kind,subject_id,safe_payload)
   VALUES($1,'test.lease','ServiceRequest',$2,'{}'::jsonb)`,[event,randomUUID()]);
  await db.query(`INSERT INTO notification_intents
   (id,domain_event_id,guest_contact_id,audience,channel,dedupe_key)
   VALUES($1,$2,$3,'CLIENT','EMAIL',$4)`,
   [intent,event,contact,'lease:'+randomUUID()]);
  await db.query(`INSERT INTO notification_deliveries
   (id,intent_id,channel) VALUES($1,$2,'EMAIL')`,[delivery,intent]);

  await db.query('BEGIN');
  const first=await claimExternalDelivery(db,90);
  assert.equal(first?.deliveryId,delivery);
  assert.equal(first?.intentId,intent);
  assert.equal(first?.channel,'EMAIL');
  await db.query('COMMIT');
  assert.equal(await claimExternalDelivery(second,90),null);
  assert.equal(await failClaimedExternalDelivery(second,delivery,randomUUID(),new Date()),null);
  assert.equal(await failClaimedExternalDelivery(second,delivery,first!.leaseToken,new Date(),2)?.then(x=>x?.state),'PENDING');
  // Retry is due later, therefore an immediate reclaim is prohibited.
  assert.equal(await claimExternalDelivery(second,90),null);

  // Both durable schedules must share precisely the same timestamp.
  const dueAt=new Date(Date.now()-1000);
  await db.query(`UPDATE notification_deliveries
   SET next_attempt_at=$2 WHERE id=$1`,[delivery,dueAt]);
  await db.query(`UPDATE notification_intents
   SET next_attempt_at=$2 WHERE id=$1`,[intent,dueAt]);
  const next=await claimExternalDelivery(second,90);
  assert.equal(next?.deliveryId,delivery);
  assert.notEqual(next?.leaseToken,first?.leaseToken);
  assert.equal(await failClaimedExternalDelivery(db,delivery,first!.leaseToken,new Date()),null);
  const terminal=await failClaimedExternalDelivery(db,delivery,next!.leaseToken,new Date(),2);
  assert.deepEqual(terminal,{state:'FAILED',attempts:2,nextAttemptAt:null});
  assert.equal(await claimExternalDelivery(second,90),null);
  const final=await db.query<{state:string;attempt_count:number;lease_token:string|null}>(`
   SELECT state,attempt_count,lease_token FROM notification_deliveries WHERE id=$1`,[delivery]);
  assert.deepEqual(final.rows,[{state:'FAILED',attempt_count:2,lease_token:null}]);
 }finally{
  await db.query('DELETE FROM notification_deliveries WHERE id=$1',[delivery]).catch(()=>{});
  await db.query('DELETE FROM notification_intents WHERE id=$1',[intent]).catch(()=>{});
  await db.query('DELETE FROM domain_outbox_events WHERE id=$1',[event]).catch(()=>{});
  await db.query('DELETE FROM guest_contacts WHERE id=$1',[contact]).catch(()=>{});
  await Promise.all([db.end(),second.end()]);
 }
});

test('external claim refuses divergent delivery/intent retry schedules',async()=>{
 const db=new Client({connectionString:process.env.DATABASE_URL});
 await db.connect();
 await db.query('BEGIN');
 const event=randomUUID(),intent=randomUUID(),delivery=randomUUID(),contact=randomUUID();
 try{
  await db.query(`INSERT INTO guest_contacts
   (id,channel,encrypted_value,digest,expires_at)
   VALUES($1,'email','encrypted-test',$2,now()+interval '1 day')`,
   [contact,'claim-parity:'+randomUUID()]);
  await db.query(`INSERT INTO domain_outbox_events
   (id,topic,subject_kind,subject_id,safe_payload)
   VALUES($1,'test.claim.schedule','ServiceRequest',$2,'{}'::jsonb)`,
   [event,randomUUID()]);
  await db.query(`INSERT INTO notification_intents
   (id,domain_event_id,guest_contact_id,audience,channel,dedupe_key,
    next_attempt_at)
   VALUES($1,$2,$3,'CLIENT','EMAIL',$4,now()+interval '10 minutes')`,
   [intent,event,contact,'claim-parity:'+randomUUID()]);
  await db.query(`INSERT INTO notification_deliveries
   (id,intent_id,channel,next_attempt_at)
   VALUES($1,$2,'EMAIL',NULL)`,[delivery,intent]);

  // The delivery is due, but its intent is not. No lease may be issued.
  assert.equal(await claimExternalDelivery(db),null);
  await db.query(`UPDATE notification_intents SET next_attempt_at=NULL WHERE id=$1`,[intent]);
  const claim=await claimExternalDelivery(db);
  assert.equal(claim?.deliveryId,delivery);
  // A worker must not be able to claim the same row again while lease is live.
  assert.equal(await claimExternalDelivery(db),null);
 }finally{
  await db.query('ROLLBACK').catch(()=>{});
  await db.end();
 }
});

test('invalid claim proofs and lease bounds fail before SQL',async()=>{
 let calls=0;
 const db={query:async()=>{calls++;throw Error('unexpected SQL');}};
 for(const seconds of [0,29,301,1.2,NaN,Infinity]){
  await assert.rejects(claimExternalDelivery(db as never,seconds),RangeError);
 }
 await assert.rejects(failClaimedExternalDelivery(db as never,'bad',randomUUID(),new Date()),/invalid_external_delivery_claim_proof/);
 await assert.rejects(failClaimedExternalDelivery(db as never,randomUUID(),randomUUID(),new Date(NaN)),RangeError);
 assert.equal(calls,0);
});

test('incomplete external delivery lease pairs are not silently reclaimed',async()=>{
 const db=new Client({connectionString:process.env.DATABASE_URL});
 await db.connect();
 await db.query('BEGIN');
 const contact=randomUUID(),event=randomUUID(),intent=randomUUID(),delivery=randomUUID();
 try{
  await db.query(`INSERT INTO guest_contacts
   (id,channel,encrypted_value,digest,expires_at)
   VALUES($1,'email','encrypted-test',$2,now()+interval '1 day')`,
   [contact,'lease-parity:'+randomUUID()]);
  await db.query(`INSERT INTO domain_outbox_events
   (id,topic,subject_kind,subject_id,safe_payload)
   VALUES($1,'test.lease.parity','ServiceRequest',$2,'{}'::jsonb)`,
   [event,randomUUID()]);
  await db.query(`INSERT INTO notification_intents
   (id,domain_event_id,guest_contact_id,audience,channel,dedupe_key)
   VALUES($1,$2,$3,'CLIENT','EMAIL',$4)`,
   [intent,event,contact,'lease-parity:'+randomUUID()]);
  await db.query(`INSERT INTO notification_deliveries
   (id,intent_id,channel,lease_token) VALUES($1,$2,'EMAIL',$3)`,
   [delivery,intent,randomUUID()]);
  // A token without an expiry is not the same as an unleased row.
  assert.equal(await claimExternalDelivery(db,90),null);
  await db.query(`UPDATE notification_deliveries
   SET lease_token=NULL,lease_expires_at=now()-interval '1 second'
   WHERE id=$1`,[delivery]);
  // An expiry without a token is also malformed, even if already due.
  assert.equal(await claimExternalDelivery(db,90),null);
  await db.query(`UPDATE notification_deliveries
   SET lease_token=$2 WHERE id=$1`,[delivery,randomUUID()]);
  // A complete expired lease may be safely reclaimed with a new proof.
  const expired=await claimExternalDelivery(db,90);
  assert.equal(expired?.deliveryId,delivery);
  assert.notEqual(expired?.leaseToken,null);
  assert.equal(await claimExternalDelivery(db,90),null);
 }finally{
  await db.query('ROLLBACK').catch(()=>{});
  await db.end();
 }
});
