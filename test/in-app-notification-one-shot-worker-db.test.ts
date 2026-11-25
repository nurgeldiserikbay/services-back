import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Client} from 'pg';
import {runOneInAppNotificationBatch} from '../src/modules/notifications/in-app-worker.js';

test('one-shot scheduled worker commits exactly one durable IN_APP delivery and leaves email pending',async()=>{
 const db=new Client({connectionString:process.env.DATABASE_URL});
 await db.connect();
 const person=randomUUID(),user=randomUUID(),event=randomUUID();
 const inApp=randomUUID(),email=randomUUID(),contact=randomUUID();
 try{
  await db.query('BEGIN');
  await db.query('INSERT INTO users(id) VALUES($1)',[user]);
  await db.query('INSERT INTO persons(id,user_id) VALUES($1,$2)',[person,user]);
  await db.query("INSERT INTO guest_contacts(id,channel,encrypted_value,digest,expires_at) VALUES($1,'email','encrypted-ci',$2,now()+interval '1 day')",
   [contact,'in-app-worker:'+randomUUID()]);
  await db.query("INSERT INTO domain_outbox_events(id,topic,subject_kind,subject_id,safe_payload) VALUES($1,'test.inapp.worker','ServiceRequest',$2,'{}'::jsonb)",
   [event,randomUUID()]);
  await db.query("INSERT INTO notification_intents(id,domain_event_id,recipient_person_id,audience,channel,dedupe_key) VALUES($1,$2,$3,'CLIENT','IN_APP',$4)",
   [inApp,event,person,'in-app-worker:'+randomUUID()]);
  await db.query("INSERT INTO notification_intents(id,domain_event_id,guest_contact_id,audience,channel,dedupe_key) VALUES($1,$2,$3,'CLIENT','EMAIL',$4)",
   [email,event,contact,'external-worker:'+randomUUID()]);
  await db.query('COMMIT');

  const first=await runOneInAppNotificationBatch(db,25);
  assert.equal(first.inAppDeliveriesMaterialized>=1,true);
  const snapshot=await db.query<{id:string;channel:string;state:string;attempt_count:number}>(`
   SELECT intent_id::text AS id,channel,state,attempt_count FROM notification_deliveries
   WHERE intent_id=ANY($1::uuid[]) ORDER BY channel`,[[inApp,email]]);
  assert.deepEqual(snapshot.rows,[
   {id:email,channel:'EMAIL',state:'PENDING',attempt_count:0},
   {id:inApp,channel:'IN_APP',state:'DELIVERED',attempt_count:1},
  ]);
  const repeated=await runOneInAppNotificationBatch(db,25);
  assert.equal(repeated.deliveryRowsStaged,0);
  assert.equal(repeated.inAppDeliveriesMaterialized,0);
  const delivered=await db.query<{state:string;attempts:number}>(`
   SELECT state,attempts FROM notification_intents WHERE id=$1`,[inApp]);
  assert.deepEqual(delivered.rows[0],{state:'DELIVERED',attempts:1});
  const outbox=await db.query<{processed_at:Date|null}>(`
   SELECT processed_at FROM domain_outbox_events WHERE id=$1`,[event]);
  assert.equal(outbox.rows[0].processed_at,null,
   'IN_APP worker must not acknowledge global domain outbox');
 }finally{
  await db.query('BEGIN').catch(()=>{});
  await db.query('DELETE FROM notification_deliveries WHERE intent_id=ANY($1::uuid[])',[[inApp,email]]).catch(()=>{});
  await db.query('DELETE FROM notification_intents WHERE id=ANY($1::uuid[])',[[inApp,email]]).catch(()=>{});
  await db.query('DELETE FROM domain_outbox_events WHERE id=$1',[event]).catch(()=>{});
  await db.query('DELETE FROM guest_contacts WHERE id=$1',[contact]).catch(()=>{});
  await db.query('DELETE FROM persons WHERE id=$1',[person]).catch(()=>{});
  await db.query('DELETE FROM users WHERE id=$1',[user]).catch(()=>{});
  await db.query('COMMIT').catch(()=>{});
  await db.end().catch(()=>{});
 }
});

test('worker never touches SQL on invalid batch size',async()=>{
 let queries=0;
 const client={query:async()=>{queries++;throw Error('unreachable')}};
 for(const limit of [0,51,-1,1.5,NaN,Infinity]){
  await assert.rejects(runOneInAppNotificationBatch(client as never,limit),RangeError);
 }
 assert.equal(queries,0);
});

test('worker rolls back errors and sanitizes connection messages; unknown commit cannot be retried',async()=>{
 const calls:string[]=[];
 const broken={query:async(text:string)=>{
  calls.push(text);
  if(text.includes('SELECT e.id::text'))throw Error('secret: db credentials should not leak');
  return {rows:[]};
 }};
 await assert.rejects(runOneInAppNotificationBatch(broken as never,25),
  error=>error instanceof Error&&error.message==='In-app notification batch unavailable');
 assert.deepEqual(calls.slice(0,3),['BEGIN',
  "SET LOCAL lock_timeout = '3s'","SET LOCAL statement_timeout = '8s'"]);
 assert.equal(calls.at(-1),'ROLLBACK');
 const commitCalls:string[]=[];
 const lostAck={query:async(text:string)=>{
  commitCalls.push(text);
  if(text==='COMMIT')throw Error('connection lost after commit');
  return {rows:[]};
 }};
 await assert.rejects(runOneInAppNotificationBatch(lostAck as never,25),
  error=>error instanceof Error&&error.message==='In-app notification batch unavailable');
 assert.equal(commitCalls.filter(x=>x==='COMMIT').length,1);
 assert.equal(commitCalls.includes('ROLLBACK'),false,
  'a lost COMMIT ack must not be treated as a rolled-back transaction');
});
