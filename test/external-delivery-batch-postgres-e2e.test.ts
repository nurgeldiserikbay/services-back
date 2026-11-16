import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Client} from 'pg';
import {processExternalNotificationBatch}
 from '../src/modules/notifications/external-delivery-batch.js';

test('bounded batch commits each PostgreSQL claim before provider reconciliation',async()=>{
 const writer=new Client({connectionString:process.env.DATABASE_URL});
 const observer=new Client({connectionString:process.env.DATABASE_URL});
 await writer.connect();
 await observer.connect();
 const contact=randomUUID(),event=randomUUID();
 const intents=[randomUUID(),randomUUID()];
 const deliveries=[randomUUID(),randomUUID()];
 const expected=new Set<string>(intents);
 const observed=new Set<string>();
 let inTransaction=false;
 let providerSends=0;
 const db={
  transaction:async<T>(fn:(client:Client)=>Promise<T>):Promise<T>=>{
   assert.equal(inTransaction,false);
   inTransaction=true;
   await writer.query('BEGIN');
   try{
    const result=await fn(writer);
    await writer.query('COMMIT');
    return result;
   }catch(error){
    await writer.query('ROLLBACK').catch(()=>{});
    throw error;
   }finally{
    inTransaction=false;
   }
  },
 };
 try{
  await writer.query(`INSERT INTO guest_contacts
   (id,channel,encrypted_value,digest,expires_at)
   VALUES($1,'email','encrypted-batch-test',$2,now()+interval '1 day')`,
   [contact,'batch:'+randomUUID()]);
  await writer.query(`INSERT INTO domain_outbox_events
   (id,topic,subject_kind,subject_id,safe_payload)
   VALUES($1,'test.external.batch','ServiceRequest',$2,'{}'::jsonb)`,
   [event,randomUUID()]);
  for(let i=0;i<2;i++){
   await writer.query(`INSERT INTO notification_intents
    (id,domain_event_id,guest_contact_id,audience,channel,dedupe_key)
    VALUES($1,$2,$3,'CLIENT','EMAIL',$4)`,
    [intents[i],event,contact,'batch:'+randomUUID()]);
   await writer.query(`INSERT INTO notification_deliveries
    (id,intent_id,channel) VALUES($1,$2,'EMAIL')`,
    [deliveries[i],intents[i]]);
  }

  const provider={
   supportsIdempotentSend:true as const,
   reconcile:async(key:string,channel:'EMAIL'|'SMS')=>{
    assert.equal(inTransaction,false,'provider I/O cannot hold transaction');
    assert.equal(channel,'EMAIL');
    assert.match(key,/^EMAIL:[0-9a-f-]+$/);
    const intentId=key.slice('EMAIL:'.length);
    assert.ok(expected.has(intentId));
    assert.equal(observed.has(intentId),false);
    observed.add(intentId);
    // This separate PostgreSQL session can see the already-committed claim.
    const active=await observer.query<{id:string;lease_token:string|null}>(
     `SELECT id::text,lease_token::text FROM notification_deliveries
      WHERE intent_id=$1::uuid AND state='PENDING'
        AND lease_expires_at>clock_timestamp()`,[intentId]);
    assert.equal(active.rows.length,1);
    assert.ok(active.rows[0].lease_token);
    // Simulates provider's durable acceptance from reconciliation.
    return 'ACCEPTED' as const;
   },
   send:async()=>{
    providerSends++;
    throw new Error('provider send must not repeat accepted notification');
   },
  };
  const outcome=await processExternalNotificationBatch(db as never,provider,2);
  assert.deepEqual(outcome,{
   examined:2,exhausted:false,sent:2,retryScheduled:0,
   failed:0,deferred:0,leaseLost:0,
  });
  assert.equal(providerSends,0);
  assert.equal(observed.size,2);
  const rows=await observer.query<{
   id:string;state:string;attempt_count:number;
   lease_token:string|null;lease_expires_at:Date|null;
  }>(`SELECT id::text,state,attempt_count,lease_token::text,lease_expires_at
    FROM notification_deliveries WHERE id=ANY($1::uuid[])`,[deliveries]);
  assert.equal(rows.rows.length,2);
  for(const item of rows.rows){
   assert.equal(item.state,'SENT');
   assert.equal(item.attempt_count,1);
   assert.equal(item.lease_token,null);
   assert.equal(item.lease_expires_at,null);
  }
  const intentRows=await observer.query<{state:string;attempts:number}>(
   `SELECT state,attempts FROM notification_intents
    WHERE id=ANY($1::uuid[])`,[intents]);
  assert.deepEqual(intentRows.rows.map(row=>row.state),['SENT','SENT']);
  assert.deepEqual(intentRows.rows.map(row=>row.attempts),[1,1]);
  // The next invocation is empty and cannot reprocess SENT records.
  assert.deepEqual(await processExternalNotificationBatch(db as never,provider,2),{
   examined:0,exhausted:true,sent:0,retryScheduled:0,
   failed:0,deferred:0,leaseLost:0,
  });
 }finally{
  await writer.query('ROLLBACK').catch(()=>{});
  await writer.query('DELETE FROM notification_deliveries WHERE id=ANY($1::uuid[])',[deliveries]).catch(()=>{});
  await writer.query('DELETE FROM notification_intents WHERE id=ANY($1::uuid[])',[intents]).catch(()=>{});
  await writer.query('DELETE FROM domain_outbox_events WHERE id=$1',[event]).catch(()=>{});
  await writer.query('DELETE FROM guest_contacts WHERE id=$1',[contact]).catch(()=>{});
  await Promise.all([writer.end(),observer.end()]);
 }
});
