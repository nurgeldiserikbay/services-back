import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Client} from 'pg';
import {createReceiverMonitoringCooldownTransport,readReceiverMonitoringOptionalCooldown}
 from '../src/modules/notifications/external-delivery-alert-receiver-monitor-cooldown-transport.js';
import {runWithReceiverMonitoringSessionLock}
 from '../src/modules/notifications/external-delivery-alert-receiver-monitor-send-lock.js';

const alert=(threshold=1)=>Object.freeze({
 code:'TERMINAL_FAILURES' as const,observed:2,threshold,
});

test('opt-in cooldown persists only after HTTPS transport success, suppresses repeats and is scoped',async()=>{
 const db=new Client({connectionString:process.env.DATABASE_URL});
 await db.connect();
 await db.query('BEGIN');
 const suffix=randomUUID().replaceAll('-','').slice(0,20);
 const scope='cooldown-send-'+suffix;
 const other='cooldown-other-'+suffix;
 let sends=0;
 const sent:unknown[]=[];
 const provider={send:async(data:unknown)=>{
  sends++;sent.push(data);
 }};
 const stage=createReceiverMonitoringCooldownTransport(db,scope,3600,provider);
 const otherStage=createReceiverMonitoringCooldownTransport(db,other,3600,provider);
 try{
  const once=(s:string,callback:()=>Promise<void>)=>
   runWithReceiverMonitoringSessionLock(db,s,callback);
  await once(scope,()=>stage.send([alert()]));
  assert.equal(sends,1);
  assert.deepEqual(sent[0],[alert()]);
  await once(scope,()=>stage.send([alert()]));
  assert.equal(sends,1);
  await once(scope,()=>stage.send([alert(2)]));
  assert.equal(sends,2,'policy threshold changes should allow new alert');
  await once(other,()=>otherStage.send([alert()]));
  assert.equal(sends,3,'separate receiver scopes cannot suppress one another');
  const rows=await db.query(
   'SELECT receiver_scope,code,last_threshold::text FROM notification_receiver_monitor_delivery_state WHERE receiver_scope = ANY($1::text[]) ORDER BY receiver_scope',
   [[scope,other]]);
  assert.equal(rows.rowCount,2);
  assert.equal(rows.rows.find(x=>x.receiver_scope===scope)?.last_threshold,'2');
  assert.equal(rows.rows.find(x=>x.receiver_scope===other)?.last_threshold,'1');
  assert.equal(JSON.stringify(sent).includes(scope),false);
 }finally{
  await db.query('ROLLBACK').catch(()=>{});
  await db.end();
 }
});

test('failed provider transport does not write a cooldown watermark',async()=>{
 const db=new Client({connectionString:process.env.DATABASE_URL});
 await db.connect();
 await db.query('BEGIN');
 const scope='cooldown-provider-fail-'+randomUUID().replaceAll('-','').slice(0,18);
 let attempts=0;
 const failing=createReceiverMonitoringCooldownTransport(db,scope,600,{
  send:async()=>{attempts++;throw Error('provider rejected');},
 });
 const successful=createReceiverMonitoringCooldownTransport(db,scope,600,{
  send:async()=>{attempts++;},
 });
 try{
  await assert.rejects(runWithReceiverMonitoringSessionLock(
   db,scope,()=>failing.send([alert()])),/provider rejected/);
  const before=await db.query(
   'SELECT count(*)::text AS count FROM notification_receiver_monitor_delivery_state WHERE receiver_scope=$1',[scope]);
  assert.equal(before.rows[0].count,'0');
  await runWithReceiverMonitoringSessionLock(db,scope,()=>successful.send([alert()]));
  assert.equal(attempts,2);
  const after=await db.query(
   'SELECT count(*)::text AS count FROM notification_receiver_monitor_delivery_state WHERE receiver_scope=$1',[scope]);
  assert.equal(after.rows[0].count,'1');
 }finally{
  await db.query('ROLLBACK').catch(()=>{});
  await db.end();
 }
});

test('cooldown is absent by default and requires exact positive seconds',()=>{
 assert.equal(readReceiverMonitoringOptionalCooldown({}),undefined);
 assert.equal(readReceiverMonitoringOptionalCooldown({
  RECEIVER_MONITOR_COOLDOWN_SECONDS:'600',
 }),600);
 let accesses=0;
 const getter=Object.defineProperty({},'RECEIVER_MONITOR_COOLDOWN_SECONDS',{
  get(){accesses++;throw Error('secret getter');},
 });
 for(const env of [
  {RECEIVER_MONITOR_COOLDOWN_SECONDS:'0'},
  {RECEIVER_MONITOR_COOLDOWN_SECONDS:'59'},
  {RECEIVER_MONITOR_COOLDOWN_SECONDS:'86401'},
  {RECEIVER_MONITOR_COOLDOWN_SECONDS:'060'},
  {RECEIVER_MONITOR_COOLDOWN_SECONDS:'600.5'},
  {RECEIVER_MONITOR_COOLDOWN_SECONDS:undefined},
  getter,
 ]){
  assert.throws(()=>readReceiverMonitoringOptionalCooldown(env),
   /invalid_receiver_monitor_cooldown_config/);
 }
 assert.equal(accesses,0);
});
