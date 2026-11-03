import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Client} from 'pg';
import {materializeInAppDeliveries,readPersonInAppInbox} from '../src/modules/notifications/in-app-materialization.js';

test('staged IN_APP intent becomes durable DELIVERED once, without sending external messages',async()=>{
 const db=new Client({connectionString:process.env.DATABASE_URL});
 await db.connect();await db.query('BEGIN');
 const userId=randomUUID(),personId=randomUUID(),eventId=randomUUID(),intentId=randomUUID();
 try{
   await db.query('INSERT INTO users(id) VALUES($1)',[userId]);
   await db.query('INSERT INTO persons(id,user_id) VALUES($1,$2)',[personId,userId]);
   await db.query(`INSERT INTO domain_outbox_events
     (id,topic,subject_kind,subject_id,safe_payload)
     VALUES($1,'test.in_app','ServiceRequest',$2,'{}'::jsonb)`,[eventId,randomUUID()]);
   await db.query(`INSERT INTO notification_intents
     (id,domain_event_id,recipient_person_id,audience,channel,dedupe_key)
     VALUES($1,$2,$3,'SELLER','IN_APP',$4)`,
     [intentId,eventId,personId,'inapp-'+randomUUID()]);
   await db.query(`INSERT INTO notification_deliveries
     (id,intent_id,channel,state) VALUES($1,$2,'IN_APP','PENDING')`,
     [randomUUID(),intentId]);
   assert.equal(await materializeInAppDeliveries(db),1);
   assert.equal(await materializeInAppDeliveries(db),0);
   const inbox=await readPersonInAppInbox(db,personId);
   assert.equal(inbox.length,1);
   assert.equal(inbox[0].id,intentId);
   assert.equal(inbox[0].topic,'test.in_app');
   assert.deepEqual(await readPersonInAppInbox(db,randomUUID()),[]);
   const state=await db.query<{state:string;attempts:number}>(
     'SELECT state,attempts FROM notification_intents WHERE id=$1',[intentId]);
   assert.equal(state.rows[0].state,'DELIVERED');
   assert.equal(state.rows[0].attempts,1);
 }finally{await db.query('ROLLBACK').catch(()=>{});await db.end();}
});

test('materializer rejects invalid batch sizes and inbox IDs before querying',async()=>{
 const never={query:async()=>{throw new Error('unexpected query')}} as never;
 for(const n of [0,-1,51,2.4,Infinity])
   await assert.rejects(materializeInAppDeliveries(never,n),RangeError);
 await assert.rejects(readPersonInAppInbox(never,'not-a-uuid'));
});
