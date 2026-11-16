import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Client} from 'pg';

test('manual notification requeue audit exists, is durable, and cannot be updated or deleted',async()=>{
 const db=new Client({connectionString:process.env.DATABASE_URL});
 await db.connect();
 try{
  const table=await db.query<{name:string|null}>(`
   SELECT to_regclass('public.notification_requeue_audit')::text AS name
  `);
  assert.equal(table.rows[0]?.name,'notification_requeue_audit');
  const key=await db.query<{count:string}>(`
   SELECT count(*)::text AS count
   FROM pg_constraint
   WHERE conrelid='notification_requeue_audit'::regclass
     AND contype='u' AND pg_get_constraintdef(oid) LIKE '%requeue_key%'
  `);
  assert.equal(key.rows[0]?.count,'1');
  const trig=await db.query<{definition:string}>(`
   SELECT pg_get_triggerdef(t.oid) AS definition
   FROM pg_trigger t
   WHERE t.tgrelid='notification_requeue_audit'::regclass
     AND t.tgname='notification_requeue_audit_immutable'
     AND NOT t.tgisinternal
  `);
  assert.equal(trig.rows.length,1);
  assert.match(trig.rows[0].definition,/BEFORE (?:UPDATE OR DELETE|DELETE OR UPDATE)/);
  assert.match(trig.rows[0].definition,/reject_notification_requeue_audit_mutation/);
  const indexes=await db.query<{count:string}>(`
   SELECT count(*)::text AS count FROM pg_indexes
   WHERE schemaname='public' AND tablename='notification_requeue_audit'
     AND indexname='notification_requeue_audit_delivery_idx'
  `);
  assert.equal(indexes.rows[0]?.count,'1');
 }finally{
  await db.end();
 }
});
