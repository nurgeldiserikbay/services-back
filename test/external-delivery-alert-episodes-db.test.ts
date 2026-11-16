import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Client} from 'pg';
import {readExternalDeliveryQueueSnapshot}
 from '../src/modules/notifications/external-delivery-monitoring.js';
import {stageExternalDeliveryAlertEpisodes}
 from '../src/modules/notifications/external-delivery-alert-episodes.js';

test('PostgreSQL alert episode stages once, recovers, and re-arms durably',async()=>{
 const db=new Client({connectionString:process.env.DATABASE_URL});
 await db.connect();
 const contact=randomUUID(),event=randomUUID(),
  intent=randomUUID(),delivery=randomUUID();
 await db.query('BEGIN');
 try{
  const base=await readExternalDeliveryQueueSnapshot(db);
  const policy={
   pendingDueThreshold:base.pendingDue+1,
   expiredLeaseThreshold:base.leasedExpired+1,
   terminalFailedThreshold:base.terminalFailed+1,
  };
  await db.query(`INSERT INTO guest_contacts
    (id,channel,encrypted_value,digest,expires_at)
    VALUES($1,'email','private-alert-test',$2,now()+interval '1 day')`,
   [contact,'alert-episode:'+randomUUID()]);
  await db.query(`INSERT INTO domain_outbox_events
    (id,topic,subject_kind,subject_id,safe_payload)
    VALUES($1,'test.alert.episode','ServiceRequest',$2,'{}'::jsonb)`,
   [event,randomUUID()]);
  await db.query(`INSERT INTO notification_intents
    (id,domain_event_id,guest_contact_id,audience,channel,dedupe_key)
    VALUES($1,$2,$3,'CLIENT','EMAIL',$4)`,
   [intent,event,contact,'alert-episode:'+randomUUID()]);
  await db.query(`INSERT INTO notification_deliveries
    (id,intent_id,channel) VALUES($1,$2,'EMAIL')`,[delivery,intent]);

  const first=await stageExternalDeliveryAlertEpisodes(db,policy);
  assert.ok(first.created>=1);
  const once=await db.query<{generation:string}>(`
   SELECT generation::text FROM notification_alert_events
   WHERE code='DUE_BACKLOG' ORDER BY generation DESC LIMIT 1`);
  assert.equal(once.rows.length,1);
  assert.deepEqual(await stageExternalDeliveryAlertEpisodes(db,policy),
   {created:0,recovered:0});
  await db.query(`UPDATE notification_deliveries
    SET next_attempt_at=now()+interval '1 hour' WHERE id=$1`,[delivery]);
  await db.query(`UPDATE notification_intents
    SET next_attempt_at=now()+interval '1 hour' WHERE id=$1`,[intent]);
  const recovered=await stageExternalDeliveryAlertEpisodes(db,policy);
  assert.ok(recovered.recovered>=1);
  await db.query(`UPDATE notification_deliveries
    SET next_attempt_at=NULL WHERE id=$1`,[delivery]);
  await db.query(`UPDATE notification_intents
    SET next_attempt_at=NULL WHERE id=$1`,[intent]);
  const again=await stageExternalDeliveryAlertEpisodes(db,policy);
  assert.ok(again.created>=1);
  const events=await db.query<{
   generation:string;observed:string;threshold:string;
  }>(`SELECT generation::text,observed::text,threshold::text
    FROM notification_alert_events WHERE code='DUE_BACKLOG'
    ORDER BY generation`);
  assert.equal(events.rows.length,2);
  assert.equal(BigInt(events.rows[1].generation),
   BigInt(events.rows[0].generation)+1n);
  assert.equal(events.rows[0].observed,String(base.pendingDue+1));
  assert.equal(events.rows[0].threshold,String(policy.pendingDueThreshold));
  assert.equal(JSON.stringify(events.rows).includes(contact),false);
  assert.equal(JSON.stringify(events.rows).includes(intent),false);
  assert.equal(JSON.stringify(events.rows).includes(delivery),false);
  await db.query('SAVEPOINT immutable_probe');
  await assert.rejects(db.query(`
    UPDATE notification_alert_events SET observed=0
    WHERE code='DUE_BACKLOG'`),/append-only/);
  await db.query('ROLLBACK TO SAVEPOINT immutable_probe');
 }finally{
  await db.query('ROLLBACK').catch(()=>{});
  await db.end();
 }
});

test('invalid client never stages an alert',async()=>{
 await assert.rejects(stageExternalDeliveryAlertEpisodes(
  null as never,{pendingDueThreshold:1,expiredLeaseThreshold:1,
   terminalFailedThreshold:1}),/invalid_external_alert_episode_database/);
});
