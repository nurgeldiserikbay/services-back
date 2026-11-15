import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {Client} from 'pg';
import {stageNotificationDeliveries} from '../src/modules/notifications/outbox-staging.js';

test('notification staging is durable, deduplicated and does not mark messages sent',async()=>{
  if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL required');
  const db=new Client({connectionString:process.env.DATABASE_URL});
  await db.connect();await db.query('BEGIN');
  const eventId=randomUUID(),contactId=randomUUID(),intentId=randomUUID(),emailIntentId=randomUUID();
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
      VALUES($1,$2,$3,'CLIENT','IN_APP',$4),
            ($5,$2,$3,'CLIENT','EMAIL',$6)
    `,[intentId,eventId,contactId,'test-staging-'+randomUUID(),emailIntentId,'test-email-staging-'+randomUUID()]);

    const result=await stageNotificationDeliveries(db,5);
    assert.equal(result.deliveriesCreated,2);
    const next=await stageNotificationDeliveries(db,5);
    assert.equal(next.deliveriesCreated,0);

    const rows=await db.query<{state:string;channel:string;attempt_count:number}>(
      'SELECT state,channel,attempt_count FROM notification_deliveries WHERE intent_id=ANY($1::uuid[]) ORDER BY channel',[[intentId,emailIntentId]]);
    assert.equal(rows.rows.length,2);
    assert.deepEqual(rows.rows.map(row=>row.channel),['EMAIL','IN_APP']);
    assert.ok(rows.rows.every(row=>row.state==='PENDING'&&row.attempt_count===0));

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
