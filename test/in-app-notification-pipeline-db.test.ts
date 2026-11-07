import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Client} from 'pg';
import {processInAppNotificationBatch}
 from '../src/modules/notifications/in-app-pipeline.js';
import {readPersonInAppInbox}
 from '../src/modules/notifications/in-app-materialization.js';

test('pipeline stages in-app and external intents, materializes only IN_APP, and is idempotent',async()=>{
 const db=new Client({connectionString:process.env.DATABASE_URL});
 await db.connect();await db.query('BEGIN');
 const user=randomUUID(),person=randomUUID(),event=randomUUID();
 const inApp=randomUUID(),contact=randomUUID(),external=randomUUID();
 try{
  await db.query('INSERT INTO users(id) VALUES($1)',[user]);
  await db.query('INSERT INTO persons(id,user_id) VALUES($1,$2)',[person,user]);
  await db.query(`INSERT INTO guest_contacts
   (id,channel,encrypted_value,digest,expires_at)
   VALUES($1,'email','encrypted-test',$2,now()+interval '1 day')`,
   [contact,'pipeline:'+randomUUID()]);
  await db.query(`INSERT INTO domain_outbox_events
   (id,topic,subject_kind,subject_id,safe_payload)
   VALUES($1,'test.pipeline','ServiceRequest',$2,'{}'::jsonb)`,
   [event,randomUUID()]);
  await db.query(`INSERT INTO notification_intents
   (id,domain_event_id,recipient_person_id,audience,channel,dedupe_key)
   VALUES($1,$2,$3,'SELLER','IN_APP',$4)`,
   [inApp,event,person,'pipeline-inapp:'+randomUUID()]);
  await db.query(`INSERT INTO notification_intents
   (id,domain_event_id,guest_contact_id,audience,channel,dedupe_key)
   VALUES($1,$2,$3,'CLIENT','EMAIL',$4)`,
   [external,event,contact,'pipeline-email:'+randomUUID()]);
  const first=await processInAppNotificationBatch(db,10);
  assert.deepEqual(first,{outboxEventsVisited:1,deliveryRowsStaged:2,
   inAppDeliveriesMaterialized:1});
  const second=await processInAppNotificationBatch(db,10);
  assert.deepEqual(second,{outboxEventsVisited:0,deliveryRowsStaged:0,
   inAppDeliveriesMaterialized:0});
  const state=await db.query<{intent_id:string;channel:string;state:string;attempt_count:number}>(`
   SELECT intent_id::text,channel,state,attempt_count
   FROM notification_deliveries WHERE intent_id=ANY($1::uuid[])
   ORDER BY channel`,[[inApp,external]]);
  assert.equal(state.rows.length,2);
  assert.deepEqual(state.rows.map(x=>[x.channel,x.state]),
   [['EMAIL','PENDING'],['IN_APP','DELIVERED']]);
  assert.equal(state.rows.find(x=>x.channel==='EMAIL')?.attempt_count,0);
  assert.equal(state.rows.find(x=>x.channel==='IN_APP')?.attempt_count,1);
  const inbox=await readPersonInAppInbox(db,person);
  assert.deepEqual(inbox.map(x=>x.id),[inApp]);
  assert.deepEqual(await readPersonInAppInbox(db,randomUUID()),[]);
  const outbox=await db.query<{processed_at:Date|null}>(
   'SELECT processed_at FROM domain_outbox_events WHERE id=$1',[event]);
  assert.equal(outbox.rows[0].processed_at,null);
 }finally{await db.query('ROLLBACK').catch(()=>{});await db.end();}
});

test('pipeline validates bounds before starting database work',async()=>{
 let calls=0;
 const fake={query:async()=>{calls++;throw Error('unexpected SQL')}};
 for(const value of [0,-1,51,1.5,Infinity,NaN]){
  await assert.rejects(processInAppNotificationBatch(fake as never,value),RangeError);
 }
 assert.equal(calls,0);
});
