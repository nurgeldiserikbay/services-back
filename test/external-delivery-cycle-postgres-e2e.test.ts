import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Client} from 'pg';
import {runExternalNotificationCycle}
 from '../src/modules/notifications/external-delivery-cycle.js';

test('outbox stages, commits, and reconciles delivery across two PostgreSQL sessions',async()=>{
 const writer=new Client({connectionString:process.env.DATABASE_URL});
 const observer=new Client({connectionString:process.env.DATABASE_URL});
 await writer.connect();
 await observer.connect();
 const contact=randomUUID(),event=randomUUID(),intent=randomUUID();
 let active=false,reconciliations=0,sends=0;
 const database={
  transaction:async<T>(fn:(client:Client)=>Promise<T>):Promise<T>=>{
   assert.equal(active,false);
   active=true;
   await writer.query('BEGIN');
   try{
    const result=await fn(writer);
    await writer.query('COMMIT');
    return result;
   }catch(error){
    await writer.query('ROLLBACK').catch(()=>{});
    throw error;
   }finally{
    active=false;
   }
  },
 };
 try{
  await writer.query(`INSERT INTO guest_contacts
   (id,channel,encrypted_value,digest,expires_at)
   VALUES($1,'email','encrypted-cycle-e2e',$2,now()+interval '1 day')`,
   [contact,'cycle-e2e:'+randomUUID()]);
  await writer.query(`INSERT INTO domain_outbox_events
   (id,topic,subject_kind,subject_id,safe_payload)
   VALUES($1,'test.external.cycle','ServiceRequest',$2,'{}'::jsonb)`,
   [event,randomUUID()]);
  await writer.query(`INSERT INTO notification_intents
   (id,domain_event_id,guest_contact_id,audience,channel,dedupe_key)
   VALUES($1,$2,$3,'CLIENT','EMAIL',$4)`,
   [intent,event,contact,'cycle-e2e:'+randomUUID()]);

  const initially=await observer.query<{id:string}>(`
   SELECT id::text FROM notification_deliveries WHERE intent_id=$1`,[intent]);
  assert.equal(initially.rows.length,0);

  const provider={
   supportsIdempotentSend:true as const,
   reconcile:async(key:string,channel:'EMAIL'|'SMS')=>{
    assert.equal(active,false,'provider called inside transaction');
    assert.equal(key,'EMAIL:'+intent);
    assert.equal(channel,'EMAIL');
    reconciliations++;
    // This observer must see both durable staging and committed claim lease.
    const visible=await observer.query<{
     state:string;lease_token:string|null;lease_expires_at:Date|null;
    }>(`SELECT state,lease_token::text,lease_expires_at
      FROM notification_deliveries WHERE intent_id=$1`,[intent]);
    assert.equal(visible.rows.length,1);
    assert.equal(visible.rows[0].state,'PENDING');
    assert.ok(visible.rows[0].lease_token);
    assert.ok(visible.rows[0].lease_expires_at);
    return 'ACCEPTED' as const;
   },
   send:async()=>{
    sends++;
    throw new Error('accepted provider receipt must not be sent twice');
   },
  };
  const first=await runExternalNotificationCycle(database as never,provider,1,1);
  assert.deepEqual(first,{
   eventsVisited:1,deliveriesCreated:1,
   examined:1,exhausted:false,sent:1,
   retryScheduled:0,failed:0,deferred:0,leaseLost:0,
  });
  assert.equal(reconciliations,1);
  assert.equal(sends,0);
  const delivery=await observer.query<{
   state:string;attempt_count:number;lease_token:string|null;
   next_attempt_at:Date|null;
  }>(`SELECT state,attempt_count,lease_token::text,next_attempt_at
    FROM notification_deliveries WHERE intent_id=$1`,[intent]);
  assert.deepEqual(delivery.rows,[{
   state:'SENT',attempt_count:1,lease_token:null,next_attempt_at:null,
  }]);
  const intentState=await observer.query<{state:string;attempts:number}>(`
   SELECT state,attempts FROM notification_intents WHERE id=$1`,[intent]);
  assert.deepEqual(intentState.rows,[{state:'SENT',attempts:1}]);
  const second=await runExternalNotificationCycle(database as never,provider,1,1);
  assert.deepEqual(second,{
   eventsVisited:0,deliveriesCreated:0,
   examined:0,exhausted:true,sent:0,
   retryScheduled:0,failed:0,deferred:0,leaseLost:0,
  });
  assert.equal(reconciliations,1);
  assert.equal(sends,0);
 }finally{
  await writer.query('ROLLBACK').catch(()=>{});
  await writer.query('DELETE FROM notification_deliveries WHERE intent_id=$1',[intent]).catch(()=>{});
  await writer.query('DELETE FROM notification_intents WHERE id=$1',[intent]).catch(()=>{});
  await writer.query('DELETE FROM domain_outbox_events WHERE id=$1',[event]).catch(()=>{});
  await writer.query('DELETE FROM guest_contacts WHERE id=$1',[contact]).catch(()=>{});
  await Promise.all([writer.end(),observer.end()]);
 }
});
