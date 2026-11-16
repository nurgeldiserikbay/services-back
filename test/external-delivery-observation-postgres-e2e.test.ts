import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Client} from 'pg';
import {readExternalDeliveryQueueSnapshot}
 from '../src/modules/notifications/external-delivery-monitoring.js';
import {observeExternalDeliveryQueue}
 from '../src/modules/notifications/external-delivery-observation.js';

test('real PostgreSQL observation publishes aggregate alerts without exposing contact or IDs',async()=>{
 const db=new Client({connectionString:process.env.DATABASE_URL});
 await db.connect();
 const contact=randomUUID(),event=randomUUID();
 const intents=[randomUUID(),randomUUID()];
 const deliveries=[randomUUID(),randomUUID()];
 const privateValue='never-expose-private-recipient-'+randomUUID();
 try{
  // A stable snapshot excludes concurrent fixtures, and ROLLBACK removes
  // all data created for this acceptance test.
  await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
  const baseline=await readExternalDeliveryQueueSnapshot(db);
  await db.query(`INSERT INTO guest_contacts
   (id,channel,encrypted_value,digest,expires_at)
   VALUES($1,'email',$2,$3,now()+interval '1 day')`,
   [contact,privateValue,'observation:'+randomUUID()]);
  await db.query(`INSERT INTO domain_outbox_events
   (id,topic,subject_kind,subject_id,safe_payload)
   VALUES($1,'test.external.observation','ServiceRequest',$2,'{}'::jsonb)`,
   [event,randomUUID()]);
  for(let i=0;i<2;i++){
   await db.query(`INSERT INTO notification_intents
    (id,domain_event_id,guest_contact_id,audience,channel,dedupe_key)
    VALUES($1,$2,$3,'CLIENT','EMAIL',$4)`,
    [intents[i],event,contact,'observation:'+randomUUID()]);
   await db.query(`INSERT INTO notification_deliveries
    (id,intent_id,channel) VALUES($1,$2,'EMAIL')`,
    [deliveries[i],intents[i]]);
  }
  // One valid due record, one durable mismatch. Never treat corrupt state
  // as a healthy due record or expose its identifiers to the publisher.
  await db.query(`UPDATE notification_intents SET attempts=1 WHERE id=$1`,
   [intents[1]]);
  const actual=await readExternalDeliveryQueueSnapshot(db);
  assert.equal(actual.pendingDue-baseline.pendingDue,1);
  assert.equal(actual.inconsistent-baseline.inconsistent,1);
  assert.equal(actual.total-baseline.total,2);

  const published:unknown[]=[];
  const result=await observeExternalDeliveryQueue(db,{
   pendingDueThreshold:baseline.pendingDue+1,
   expiredLeaseThreshold:baseline.leasedExpired+1,
   terminalFailedThreshold:baseline.terminalFailed+1,
  },async alert=>{published.push(alert);},new AbortController().signal);
  const expectedCodes=[
   ...(actual.inconsistent>0?['QUEUE_INCONSISTENT']:[]),
   'DUE_BACKLOG',
  ];
  assert.deepEqual(published.map(item=>(item as {code:string}).code),expectedCodes);
  assert.deepEqual(result,{alertsPublished:expectedCodes.length});
  const serialized=JSON.stringify({result,published});
  for(const secret of [contact,event,...intents,...deliveries,privateValue]){
   assert.equal(serialized.includes(secret),false);
  }
  for(const item of published){
   assert.deepEqual(Object.keys(item as object).sort(),
    ['code','observed','severity','threshold']);
  }
 }finally{
  await db.query('ROLLBACK').catch(()=>{});
  await db.end();
 }
});
