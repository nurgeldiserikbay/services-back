import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {Client} from 'pg';
import {stageNotificationDeliveries} from '../src/modules/notifications/outbox-staging.js';

test('notification staging is durable, deduplicated and does not mark messages sent',async()=>{
  if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL required');
  const db=new Client({connectionString:process.env.DATABASE_URL});
  await db.connect();await db.query('BEGIN');
  const eventId=randomUUID(),contactId=randomUUID(),intentId=randomUUID();
  try{
    await db.query(`INSERT INTO guest_contacts
      (id,channel,encrypted_value,digest,expires_at)
      VALUES($1,'email','encrypted-test-value',$2,now()+interval '1 day')
    `,[contactId,'outbox-test:'+randomUUID()]);
    await db.query(`INSERT INTO domain_outbox_events
      (id,topic,subject_kind,subject_id,safe_payload)
      VALUES($1,'test.notification.staging','ServiceRequest',$2,'{}'::jsonb)
    `,[eventId,randomUUID()]);
    await db.query(`INSERT INTO notification_intents
      (id,domain_event_id,guest_contact_id,audience,channel,dedupe_key)
      VALUES($1,$2,$3,'CLIENT','IN_APP',$4)
    `,[intentId,eventId,contactId,'test-staging-'+randomUUID()]);

    const result=await stageNotificationDeliveries(db,5);
    assert.equal(result.deliveriesCreated,1);
    const next=await stageNotificationDeliveries(db,5);
    assert.equal(next.deliveriesCreated,0);

    const rows=await db.query<{state:string;channel:string;attempt_count:number}>(
      'SELECT state,channel,attempt_count FROM notification_deliveries WHERE intent_id=$1',[intentId]);
    assert.equal(rows.rows.length,1);
    assert.equal(rows.rows[0].state,'PENDING');
    assert.equal(rows.rows[0].channel,'IN_APP');
    assert.equal(rows.rows[0].attempt_count,0);

    const event=await db.query<{processed_at:Date|null}>(
      'SELECT processed_at FROM domain_outbox_events WHERE id=$1',[eventId]);
    assert.equal(event.rows[0].processed_at,null);
    const intent=await db.query<{state:string}>(
      'SELECT state FROM notification_intents WHERE id=$1',[intentId]);
    assert.equal(intent.rows[0].state,'PENDING');
  }finally{
    await db.query('ROLLBACK').catch(()=>{});
    await db.end();
  }
});

test('outbox staging rejects unbounded batches before querying',async()=>{
  const never={query:async()=>{throw new Error('should not query')}} as never;
  for(const limit of [0,-1,51,1.2,Infinity]){
    await assert.rejects(stageNotificationDeliveries(never,limit),RangeError);
  }
});
