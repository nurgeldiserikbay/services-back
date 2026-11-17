import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Client} from 'pg';
import {acceptExternalDeliveryAlertIngress}
 from '../src/modules/notifications/external-delivery-alert-receiver-ingress.js';
import {claimExternalAlertReceiverIngress}
 from '../src/modules/notifications/external-delivery-alert-receiver-claim.js';
import {recordExternalAlertReceiverDeliveryFailure}
 from '../src/modules/notifications/external-delivery-alert-receiver-failure.js';
import {deliverOneExternalAlertReceiverIngress}
 from '../src/modules/notifications/external-delivery-alert-receiver-cycle.js';

const policy={baseDelayMs:1000,maxDelayMs:5000,maxAttempts:2};
const scope='staging-kz';
const uuid=randomUUID();
const lease=randomUUID();

test('receiver failure rejects wrong scope/token and invalid policy before SQL',async()=>{
 let queries=0;
 const db={query:async()=>{queries++;throw new Error('unexpected SQL');}} as never;
 await assert.rejects(recordExternalAlertReceiverDeliveryFailure(
  db,'INVALID',uuid,lease,policy),
  /invalid_external_alert_receiver_failure/);
 await assert.rejects(recordExternalAlertReceiverDeliveryFailure(
  db,scope,uuid,'bad-token',policy),
  /invalid_external_alert_receiver_failure/);
 await assert.rejects(recordExternalAlertReceiverDeliveryFailure(
  db,scope,uuid,lease,{...policy,maxAttempts:0}),
  /invalid_external_alert_receiver_retry_policy/);
 assert.equal(queries,0);
});

test('receiver error boundary records retry, then terminal state after exhausted attempt',async()=>{
 const db=new Client({connectionString:process.env.DATABASE_URL});
 await db.connect();
 await db.query('BEGIN');
 const receiverScope='staging-'+randomUUID().replaceAll('-','').slice(0,18);
 const key='services-alert-v2-'+'f'.repeat(64);
 try{
  await acceptExternalDeliveryAlertIngress(db,receiverScope,key,[{
   code:'DUE_BACKLOG',severity:'warning',observed:3,threshold:2,
  }]);
  const first=await claimExternalAlertReceiverIngress(db,receiverScope,1,5000);
  assert.equal(first.length,1);
  assert.equal(await recordExternalAlertReceiverDeliveryFailure(
   db,receiverScope,first[0].id,first[0].token,policy),'scheduled');
  assert.equal(await recordExternalAlertReceiverDeliveryFailure(
   db,'prod-kz',first[0].id,first[0].token,policy),'stale');
  await db.query(`
   UPDATE notification_alert_receiver_ingress
   SET lease_expires_at=clock_timestamp()-interval '1 second'
   WHERE id=$1`,[first[0].id]);
  assert.deepEqual(await claimExternalAlertReceiverIngress(
   db,receiverScope,1,5000),[]);
  await db.query(`
   UPDATE notification_alert_receiver_retry_schedule
   SET next_attempt_at=clock_timestamp()-interval '1 second'
   WHERE ingress_id=$1`,[first[0].id]);
  const second=await claimExternalAlertReceiverIngress(db,receiverScope,1,5000);
  assert.equal(second.length,1);
  assert.notEqual(second[0].token,first[0].token);
  assert.equal(await recordExternalAlertReceiverDeliveryFailure(
   db,receiverScope,first[0].id,first[0].token,policy),'stale');
  assert.equal(await recordExternalAlertReceiverDeliveryFailure(
   db,receiverScope,second[0].id,second[0].token,policy),'terminal');
  const terminal=await db.query<{reason_code:string}>(`
   SELECT reason_code FROM notification_alert_receiver_terminal_failures
   WHERE ingress_id=$1`,[second[0].id]);
  assert.deepEqual(terminal.rows,[{reason_code:'ATTEMPTS_EXHAUSTED'}]);
  await db.query(`
   UPDATE notification_alert_receiver_ingress
   SET lease_expires_at=clock_timestamp()-interval '1 second'
   WHERE id=$1`,[second[0].id]);
  assert.deepEqual(await claimExternalAlertReceiverIngress(
   db,receiverScope,1,5000),[]);
  await db.query('SAVEPOINT terminal_immutable');
  await assert.rejects(db.query(`
   DELETE FROM notification_alert_receiver_terminal_failures
   WHERE ingress_id=$1`,[second[0].id]),/immutable/);
  await db.query('ROLLBACK TO SAVEPOINT terminal_immutable');
 }finally{
  await db.query('ROLLBACK').catch(()=>{});
  await db.end();
 }
});

test('opt-in delivery cycle records failure without exposing provider exception',async()=>{
 const id=randomUUID(),token=randomUUID();
 let calls=0;
 const db={query:async()=>{
  calls++;
  if(calls===1)return {rows:[{
   id,lease_token:token,alerts:[{
    code:'DUE_BACKLOG',severity:'warning',observed:3,threshold:2,
   }],
  }]};
  if(calls===2)return {rows:[{claim_count:'1'}]};
  if(calls===3)return {rows:[{ingress_id:id}]};
  throw new Error('unexpected query');
 }} as never;
 const secret='private-token-and-provider-response';
 await assert.rejects(deliverOneExternalAlertReceiverIngress(
  db,scope,30000,{send:async()=>{throw new Error(secret);}},
  {...policy,maxAttempts:3}),error=>{
   assert.equal((error as Error).message,'external_alert_receiver_delivery_failed');
   assert.equal((error as Error).cause,undefined);
   assert.equal(String(error).includes(secret),false);
   return true;
  });
 assert.equal(calls,3);
});

test('failure policy rejects malformed driver attempt count before scheduling',async()=>{
 let calls=0,reads=0;
 const unsafe=Object.defineProperty({},'claim_count',{
  get(){reads++;throw new Error('unexpected getter');},
 });
 const db={query:async()=>{
  calls++;
  return {rows:[unsafe]};
 }} as never;
 await assert.rejects(recordExternalAlertReceiverDeliveryFailure(
  db,scope,uuid,lease,policy),/invalid_external_alert_receiver_database/);
 assert.equal(calls,1);
 assert.equal(reads,0);
});
