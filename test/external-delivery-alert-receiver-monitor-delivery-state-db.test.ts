import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Client} from 'pg';
import {
 selectReceiverMonitoringDueBreaches,
 recordReceiverMonitoringDelivered,
} from '../src/modules/notifications/external-delivery-alert-receiver-monitor-delivery-state.js';

const alert=(threshold=1)=>Object.freeze({
 code:'TERMINAL_FAILURES' as const,observed:2,threshold,
});

test('durable monitoring suppression is scoped, threshold-aware and only records explicit success',async()=>{
 const db=new Client({connectionString:process.env.DATABASE_URL});
 await db.connect();
 await db.query('BEGIN');
 const suffix=randomUUID().replaceAll('-','').slice(0,20);
 const scope='cooldown-'+suffix;
 const other='cooldown-other-'+suffix;
 try{
  const first=await selectReceiverMonitoringDueBreaches(db,scope,[alert()],3600);
  assert.deepEqual(first,[alert()]);
  assert.equal(Object.isFrozen(first),true);
  assert.equal(Object.isFrozen(first[0]),true);
  // A provider failure never advances state (no record call).
  assert.deepEqual(await selectReceiverMonitoringDueBreaches(
   db,scope,[alert()],3600),[alert()]);
  await recordReceiverMonitoringDelivered(db,scope,first);
  assert.deepEqual(await selectReceiverMonitoringDueBreaches(
   db,scope,[alert()],3600),[]);
  assert.deepEqual(await selectReceiverMonitoringDueBreaches(
   db,other,[alert()],3600),[alert()]);
  assert.deepEqual(await selectReceiverMonitoringDueBreaches(
   db,scope,[alert(2)],3600),[alert(2)]);
  assert.deepEqual(await selectReceiverMonitoringDueBreaches(
   db,scope,[alert()],60),[]);
  const row=await db.query(
   'SELECT receiver_scope,code,last_threshold::text FROM notification_receiver_monitor_delivery_state WHERE receiver_scope=$1',
   [scope]);
  assert.deepEqual(row.rows,[{
   receiver_scope:scope,code:'TERMINAL_FAILURES',last_threshold:'1',
  }]);
 }finally{
  await db.query('ROLLBACK').catch(()=>{});
  await db.end();
 }
});

test('durable receiver monitoring cooldown updates all alert codes atomically',async()=>{
 const db=new Client({connectionString:process.env.DATABASE_URL});
 await db.connect();
 await db.query('BEGIN');
 const scope='cooldown-multi-'+randomUUID().replaceAll('-','').slice(0,20);
 const breaches=[
  alert(),
  {code:'RETRY_BACKLOG' as const,observed:3,threshold:2},
 ];
 try{
  assert.deepEqual(await selectReceiverMonitoringDueBreaches(
   db,scope,breaches,3600),breaches);
  await recordReceiverMonitoringDelivered(db,scope,breaches);
  assert.deepEqual(await selectReceiverMonitoringDueBreaches(
   db,scope,breaches,3600),[]);
  const count=await db.query<{count:string}>(
   'SELECT count(*)::text AS count FROM notification_receiver_monitor_delivery_state WHERE receiver_scope=$1',[scope]);
  assert.equal(count.rows[0].count,'2');
 }finally{
  await db.query('ROLLBACK').catch(()=>{});
  await db.end();
 }
});

test('cooldown state rejects malformed inputs before SQL, with no default window',async()=>{
 let queries=0,accesses=0;
 const db={query:async()=>{queries++;throw Error('SQL must not run');}} as never;
 const getter=Object.defineProperty({...alert()},'observed',{
  get(){accesses++;throw Error('accessor executed');},
 });
 for(const cooldown of [0,59,86401,1.5,NaN]){
  await assert.rejects(selectReceiverMonitoringDueBreaches(
   db,'staging-scope',[alert()],cooldown),
   /invalid_receiver_monitor_delivery_state_input/);
 }
 for(const input of [
  [getter],
  [{...alert(),token:'private'}],
  [alert(),alert()],
  [{...alert(),threshold:0}],
 ]){
  await assert.rejects(selectReceiverMonitoringDueBreaches(
   db,'staging-scope',input as never,120),
   /invalid_receiver_monitor_delivery_state_input/);
 }
 await assert.rejects(recordReceiverMonitoringDelivered(db,'INVALID',[alert()]),
  /invalid_receiver_monitor_delivery_state_input/);
 assert.equal(queries,0);
 assert.equal(accesses,0);
});
