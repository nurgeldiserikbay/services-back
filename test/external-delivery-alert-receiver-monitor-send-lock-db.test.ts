import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Client} from 'pg';
import {runWithReceiverMonitoringSessionLock}
 from '../src/modules/notifications/external-delivery-alert-receiver-monitor-send-lock.js';

test('receiver staging send advisory lock serializes same-scope PostgreSQL processes',async()=>{
 const first=new Client({connectionString:process.env.DATABASE_URL});
 const second=new Client({connectionString:process.env.DATABASE_URL});
 await first.connect();
 await second.connect();
 // A fixed test-specific scope has no relation to real operator scopes.
 const scope='staging-guard-test';
 let letGo:()=>void=()=>{};
 const held=new Promise<void>(resolve=>{letGo=resolve;});
 let hasLock:()=>void=()=>{};
 const entered=new Promise<void>(resolve=>{hasLock=resolve;});
 try{
  const running=runWithReceiverMonitoringSessionLock(first,scope,async()=>{
   hasLock();
   await held;
   return 'first-completed';
  });
  await entered;
  let executed=0;
  await assert.rejects(runWithReceiverMonitoringSessionLock(
   second,scope,async()=>{executed++;return 'unexpected';}),
   /external_alert_receiver_send_already_running/);
  assert.equal(executed,0);
  // Other scopes are not blocked by the same advisory key.
  assert.equal(await runWithReceiverMonitoringSessionLock(
   second,scope+'-other',async()=>{executed++;return 'other-completed';}),
   'other-completed');
  assert.equal(executed,1);
  letGo();
  assert.equal(await running,'first-completed');
  assert.equal(await runWithReceiverMonitoringSessionLock(
   second,scope,async()=> 'reused-after-unlock'),'reused-after-unlock');
 }finally{
  letGo();
  await Promise.all([first.end(),second.end()]);
 }
});

test('staging send releases advisory lock when user operation rejects',async()=>{
 const db=new Client({connectionString:process.env.DATABASE_URL});
 await db.connect();
 try{
  await assert.rejects(runWithReceiverMonitoringSessionLock(
   db,'staging-lock-failure',async()=>{throw Error('provider offline');}),
   /provider offline/);
  assert.equal(await runWithReceiverMonitoringSessionLock(
   db,'staging-lock-failure',async()=> 'lock-released'),'lock-released');
 }finally{await db.end();}
});

test('staging send refuses unsafe scope before SQL or operation',async()=>{
 let queries=0,operations=0;
 const db={query:async()=>{queries++;throw Error('unexpected');}} as never;
 for(const scope of ['','BAD_SCOPE','bad/scope','a'.repeat(65)]){
  await assert.rejects(runWithReceiverMonitoringSessionLock(
   db,scope,async()=>{operations++;return 1;}),
   /invalid_external_alert_receiver_send_lock/);
 }
 assert.equal(queries,0);
 assert.equal(operations,0);
});
