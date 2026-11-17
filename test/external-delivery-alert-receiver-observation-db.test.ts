import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Client} from 'pg';
import {observeExternalAlertReceiver}
 from '../src/modules/notifications/external-delivery-alert-receiver-observation.js';
import {acceptExternalDeliveryAlertIngress}
 from '../src/modules/notifications/external-delivery-alert-receiver-ingress.js';

const thresholds=()=>({retryScheduled:1,leasedExpired:1,terminal:1,inconsistent:1});
const empty=()=>({ready:0,retryScheduled:0,leasedActive:0,leasedExpired:0,
 terminal:0,acknowledged:0,inconsistent:0,total:0});

test('receiver observation validates policy and scope before requesting SQL',async()=>{
 let queries=0;
 const db={query:async()=>{queries++;throw Error('unexpected query');}} as never;
 await assert.rejects(observeExternalAlertReceiver(db,'valid-scope',
  {...thresholds(),terminal:0}),
  /invalid_external_alert_receiver_monitor_policy/);
 await assert.rejects(observeExternalAlertReceiver(db,'BAD_SCOPE',thresholds()),
  /invalid_external_alert_receiver_monitor_input/);
 assert.equal(queries,0);
});

test('receiver observation rejects malformed SQL snapshot and propagates failures',async()=>{
 const invalid={...empty(),ready:'0',total:'1'};
 const db={query:async()=>({rows:[invalid]})} as never;
 await assert.rejects(observeExternalAlertReceiver(db,'staging-kz',thresholds()),
  /invalid_external_alert_receiver_monitor_snapshot/);
 const failed={query:async()=>{throw Error('postgres unavailable');}} as never;
 await assert.rejects(observeExternalAlertReceiver(failed,'staging-kz',thresholds()),
  /postgres unavailable/);
});

test('PostgreSQL receiver observation is count-only and scoped across deployments',async()=>{
 const db=new Client({connectionString:process.env.DATABASE_URL});
 await db.connect();
 await db.query('BEGIN');
 const suffix=randomUUID().replaceAll('-','').slice(0,15);
 const scope='monitor-'+suffix;
 const other='another-'+suffix;
 const alerts=[{code:'DUE_BACKLOG',severity:'warning',observed:2,threshold:2}] as const;
 const key=(c:string)=>'services-alert-v2-'+c.repeat(64);
 try{
  assert.equal(await acceptExternalDeliveryAlertIngress(db,scope,key('a'),alerts),
   'accepted');
  assert.equal(await acceptExternalDeliveryAlertIngress(db,other,key('b'),alerts),
   'accepted');
  const observed=await observeExternalAlertReceiver(db,scope,thresholds());
  assert.deepEqual(observed.counts,{...empty(),ready:1,total:1});
  assert.deepEqual(observed.breaches,[]);
  assert.equal(Object.isFrozen(observed),true);
  assert.equal(Object.isFrozen(observed.counts),true);
  assert.equal(Object.isFrozen(observed.breaches),true);
  assert.equal(JSON.stringify(observed).includes(key('a')),false);
  assert.equal(JSON.stringify(observed).includes(scope),false);
  const otherObserved=await observeExternalAlertReceiver(db,other,thresholds());
  assert.equal(otherObserved.counts.ready,1);
  const absent=await observeExternalAlertReceiver(db,'nonexistent-'+suffix,thresholds());
  assert.equal(absent.counts.total,0);
 }finally{
  await db.query('ROLLBACK').catch(()=>{});
  await db.end();
 }
});
