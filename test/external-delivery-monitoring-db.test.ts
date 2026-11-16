import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Client} from 'pg';
import {readExternalDeliveryQueueSnapshot}
 from '../src/modules/notifications/external-delivery-monitoring.js';

const empty={
 pending_due:'0',pending_scheduled:'0',leased_active:'0',
 leased_expired:'0',terminal_failed:'0',provider_accepted:'0',
 inconsistent:'0',total:'0',
};

test('monitoring snapshot validates safe integer counts and sum before returning',async()=>{
 let calls=0;
 const client={query:async(sql:string,params:unknown[])=>{
  calls++;
  assert.match(sql,/notification_deliveries/);
  assert.match(sql,/notification_intents/);
  assert.match(sql,/statement_timestamp\(\)/);
  assert.deepEqual(params,[]);
  return {rows:[empty]};
 }};
 assert.deepEqual(await readExternalDeliveryQueueSnapshot(client as never),{
  pendingDue:0,pendingScheduled:0,leasedActive:0,leasedExpired:0,
  terminalFailed:0,providerAccepted:0,inconsistent:0,total:0,
 });
 assert.equal(calls,1);
 for(const result of [
  {rows:[]},{rows:[empty,empty]},
  {rows:[{...empty,total:'1'}]},
  {rows:[{...empty,total:'-1'}]},
  {rows:[{...empty,total:'9007199254740992'}]},
  {rows:[{...empty,total:'not-a-count'}]},
 ]){
  await assert.rejects(readExternalDeliveryQueueSnapshot({
   query:async()=>result,
  } as never),/invalid_notification_monitor_snapshot/);
 }
});

test('PostgreSQL snapshot buckets due, leased, failed and inconsistent rows without PII',async()=>{
 const db=new Client({connectionString:process.env.DATABASE_URL});
 await db.connect();
 await db.query('BEGIN');
 const contact=randomUUID(),event=randomUUID();
 const intentIds=Array.from({length:5},()=>randomUUID());
 const deliveryIds=Array.from({length:5},()=>randomUUID());
 try{
  const base=await readExternalDeliveryQueueSnapshot(db);
  await db.query(`INSERT INTO guest_contacts
   (id,channel,encrypted_value,digest,expires_at)
   VALUES($1,'email','private-test-address',$2,now()+interval '1 day')`,
   [contact,'monitor:'+randomUUID()]);
  await db.query(`INSERT INTO domain_outbox_events
   (id,topic,subject_kind,subject_id,safe_payload)
   VALUES($1,'test.external.monitor','ServiceRequest',$2,'{}'::jsonb)`,
   [event,randomUUID()]);
  const states=['PENDING','PENDING','PENDING','FAILED','PENDING'];
  for(let i=0;i<5;i++){
   await db.query(`INSERT INTO notification_intents
    (id,domain_event_id,guest_contact_id,audience,channel,dedupe_key,state,attempts)
    VALUES($1,$2,$3,'CLIENT','EMAIL',$4,$5,0)`,
    [intentIds[i],event,contact,'monitor:'+randomUUID(),states[i]]);
   await db.query(`INSERT INTO notification_deliveries
    (id,intent_id,channel,state,attempt_count)
    VALUES($1,$2,'EMAIL',$3,0)`,
    [deliveryIds[i],intentIds[i],states[i]]);
  }
  await db.query(`UPDATE notification_deliveries
    SET lease_token=$2,lease_expires_at=now()+interval '90 seconds'
    WHERE id=$1`,[deliveryIds[1],randomUUID()]);
  await db.query(`UPDATE notification_deliveries
    SET next_attempt_at=now()-interval '1 second' WHERE id=$1`,[deliveryIds[2]]);
  await db.query(`UPDATE notification_intents SET attempts=1 WHERE id=$1`,
    [intentIds[4]]);
  const snapshot=await readExternalDeliveryQueueSnapshot(db);
  assert.equal(snapshot.pendingDue-base.pendingDue,1);
  assert.equal(snapshot.leasedActive-base.leasedActive,1);
  assert.equal(snapshot.terminalFailed-base.terminalFailed,1);
  assert.equal(snapshot.inconsistent-base.inconsistent,2);
  assert.equal(snapshot.total-base.total,5);
  assert.deepEqual(Object.keys(snapshot).sort(),Object.keys(base).sort());
  assert.equal(JSON.stringify(snapshot).includes('private-test-address'),false);
 }finally{
  await db.query('ROLLBACK').catch(()=>{});
  await db.end();
 }
});
