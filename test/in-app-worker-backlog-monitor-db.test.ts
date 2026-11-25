import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Client} from 'pg';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {readInAppQueueHealth,assessInAppQueueHealth}
 from '../src/modules/notifications/in-app-queue-health.js';

test('IN_APP queue monitor measures immutable outbox age and ignores EMAIL',async()=>{
 const db=new Client({connectionString:process.env.DATABASE_URL});
 await db.connect();
 await db.query('BEGIN');
 const user=randomUUID(),person=randomUUID(),event=randomUUID();
 const pending=randomUUID(),delivered=randomUUID(),external=randomUUID(),contact=randomUUID();
 try{
  const baseline=await readInAppQueueHealth(db);
  await db.query('INSERT INTO users(id) VALUES($1)',[user]);
  await db.query('INSERT INTO persons(id,user_id) VALUES($1,$2)',[person,user]);
  await db.query("INSERT INTO guest_contacts(id,channel,encrypted_value,digest,expires_at) VALUES($1,'email','ci-opaque',$2,now()+interval '1 day')",
   [contact,'inapp-health:'+randomUUID()]);
  await db.query("INSERT INTO domain_outbox_events(id,topic,subject_kind,subject_id,created_at,safe_payload) VALUES($1,'test.queue.health','ServiceRequest',$2,now()-interval '32 minutes','{}'::jsonb)",
   [event,randomUUID()]);
  await db.query("INSERT INTO notification_intents(id,domain_event_id,recipient_person_id,audience,channel,dedupe_key,state) VALUES($1,$2,$3,'CLIENT','IN_APP',$4,'PENDING'),($5,$2,$3,'CLIENT','IN_APP',$6,'DELIVERED')",
   [pending,event,person,'health-pending:'+randomUUID(),delivered,'health-delivered:'+randomUUID()]);
  await db.query("INSERT INTO notification_intents(id,domain_event_id,guest_contact_id,audience,channel,dedupe_key,state) VALUES($1,$2,$3,'CLIENT','EMAIL',$4,'PENDING')",
   [external,event,contact,'health-email:'+randomUUID()]);
  const after=await readInAppQueueHealth(db);
  // Other test processes can commit into the same disposable CI DB between
  // aggregate snapshots. Verify own fixture exactly; totals are lower bounds.
  assert.ok(after.pending>=baseline.pending+1);
  assert.ok(after.delivered>=baseline.delivered+1);
  const own=await db.query<{channel:string;state:string}>(`
   SELECT channel,state FROM notification_intents
   WHERE domain_event_id=$1 ORDER BY channel, CASE WHEN state='DELIVERED' THEN 0 ELSE 1 END`,[event]);
  assert.deepEqual(own.rows,[
   {channel:'EMAIL',state:'PENDING'},
   {channel:'IN_APP',state:'DELIVERED'},
   {channel:'IN_APP',state:'PENDING'},
  ]);
  // Keep a one-minute cushion around timestamp precision and test scheduling.
  assert.ok(after.oldestPendingSeconds>=1860);
  const alert=assessInAppQueueHealth(after,after.pending,900);
  assert.equal(alert.ageOverLimit,true);
  assert.equal(alert.pendingOverLimit,false);
  assert.equal(alert.healthy,false);
 }finally{
  await db.query('ROLLBACK').catch(()=>{});
  await db.end();
 }
});

test('monitor does not query or expose secrets on database failures',async()=>{
 let calls=0;
 await assert.rejects(readInAppQueueHealth({query:async()=>{
  calls++;throw Error('postgres password=private-user-token');
 }} as never),error=>error instanceof Error&&
  error.message==='IN_APP queue observation unavailable');
 assert.equal(calls,1);
 for(const raw of ['abc','-1','9007199254740992']){
  await assert.rejects(readInAppQueueHealth({query:async()=>({
   rows:[{pending:raw,delivered:'0',oldest_pending_seconds:'0'}],
  })} as never),/IN_APP queue observation unavailable/);
 }
});

test('monitor rejects malformed aggregate result shapes',async()=>{
 const ok={pending:'1',delivered:'2',oldest_pending_seconds:'90'};
 const cases=[[],[ok,ok],[{...ok,pending:null}],[{...ok,delivered:'01'}],
  [{...ok,oldest_pending_seconds:null}],[{...ok,pending:1}]];
 for(const rows of cases){
  await assert.rejects(readInAppQueueHealth({query:async()=>({rows})} as never),
   /IN_APP queue observation unavailable/);
 }
});
test('queue alert thresholds have a deterministic healthy boundary',()=>{
 assert.deepEqual(assessInAppQueueHealth({
  pending:500,delivered:3,oldestPendingSeconds:900,
 }),{healthy:true,pendingOverLimit:false,ageOverLimit:false});
 assert.deepEqual(assessInAppQueueHealth({
  pending:501,delivered:3,oldestPendingSeconds:901,
 }),{healthy:false,pendingOverLimit:true,ageOverLimit:true});
 assert.deepEqual(assessInAppQueueHealth({
  pending:0,delivered:0,oldestPendingSeconds:9999,
 }),{healthy:true,pendingOverLimit:false,ageOverLimit:false});
 for(const bad of [NaN,Infinity,-1,1.5,1000001]){
  assert.throws(()=>assessInAppQueueHealth({
   pending:0,delivered:0,oldestPendingSeconds:0,
  },bad),RangeError);
 }
 for(const bad of [NaN,Infinity,59,1.5,86401]){
  assert.throws(()=>assessInAppQueueHealth({
   pending:0,delivered:0,oldestPendingSeconds:0,
  },500,bad),RangeError);
 }
});

test('monitor CLI is default-off and uses read-only transaction with safe logging',()=>{
 const script=readFileSync(resolve(process.cwd(),'scripts/check-in-app-worker-health.ts'),'utf8');
 assert.match(script,/SERVICES_ENABLE_IN_APP_MONITOR!=='enabled'/);
 assert.match(script,/BEGIN READ ONLY/);
 assert.match(script,/process\.exitCode=2/);
 assert.doesNotMatch(script,/console\.(?:log|error)\(.*(?:uri|DATABASE_URL|token|person|secret)/i);
 assert.match(script,/console\.error\('IN_APP monitor failed or is disabled'\)/);
});
