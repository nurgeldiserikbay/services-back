import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {Client} from 'pg';
import {issueAdminSessionToken} from '../src/modules/admin/admin-session-token.js';
import {requeueFailedOrganizationDelivery}
 from '../src/modules/notifications/dead-letter-requeue.js';

test('live PostgreSQL audited requeue is scoped, atomic and idempotent after state transition',async()=>{
 const db=new Client({connectionString:process.env.DATABASE_URL});
 const pepper=randomBytes(32),{token,tokenHash}=issueAdminSessionToken(pepper);
 const user=randomUUID(),person=randomUUID(),organization=randomUUID();
 const staff=randomUUID(),session=randomUUID(),grant=randomUUID();
 const event=randomUUID(),intent=randomUUID(),delivery=randomUUID();
 const key=randomUUID(),scope='organization:'+organization;
 let reconciles=0;
 await db.connect();
 await db.query('BEGIN');
 try{
  await db.query('INSERT INTO users(id) VALUES($1)',[user]);
  await db.query('INSERT INTO persons(id,user_id) VALUES($1,$2)',[person,user]);
  await db.query(`INSERT INTO organizations(id,owner_person_id,slug,name,status)
   VALUES($1,$2,$3,'Requeue fixture','ACTIVE')`,
   [organization,person,'requeue-'+randomUUID()]);
  await db.query(`INSERT INTO platform_admin_staff(id,user_id,role)
   VALUES($1,$2,'admin')`,[staff,user]);
  await db.query(`INSERT INTO platform_admin_sessions
   (id,staff_id,token_hash,mfa_verified_at,expires_at)
   VALUES($1,$2,$3,now(),now()+interval '1 hour')`,
   [session,staff,tokenHash]);
  await db.query(`INSERT INTO platform_admin_totp_factors(
    staff_id,encrypted_secret,key_version,created_at,activated_at)
   VALUES($1,'requeue-test-only','test',now()-interval '5 minutes',
    now()-interval '3 minutes')`,[staff]);
  await db.query(`INSERT INTO platform_admin_grants(id,staff_id,scope)
   VALUES($1,$2,$3)`,[grant,staff,scope]);
  await db.query(`INSERT INTO domain_outbox_events(
   id,topic,subject_kind,subject_id,safe_payload)
   VALUES($1,'test.notification.requeue','Organization',$2,'{}'::jsonb)`,
   [event,organization]);
  await db.query(`INSERT INTO notification_intents(
   id,domain_event_id,recipient_org_id,audience,channel,state,attempts,dedupe_key)
   VALUES($1,$2,$3,'SELLER','EMAIL','FAILED',5,$4)`,
   [intent,event,organization,'requeue-'+randomUUID()]);
  await db.query(`INSERT INTO notification_deliveries
   (id,intent_id,channel,state,attempt_count)
   VALUES($1,$2,'EMAIL','FAILED',5)`,[delivery,intent]);

  const database={
   query:db.query.bind(db),
   transaction:async<T>(operation:(client:Client)=>Promise<T>):Promise<T>=>operation(db),
  };
  const provider={
   supportsIdempotentSend:true as const,
   reconcile:async(idempotency:string,channel:'EMAIL'|'SMS')=>{
    reconciles++;
    assert.equal(idempotency,'EMAIL:'+intent);
    assert.equal(channel,'EMAIL');
    return 'NOT_FOUND' as const;
   },
  };
  assert.equal(await requeueFailedOrganizationDelivery(
   database as never,provider,token,pepper,delivery,key,
   'organization:'+randomUUID()),'DENIED');
  assert.equal(reconciles,0);
  assert.equal(await requeueFailedOrganizationDelivery(
   database as never,provider,token,pepper,delivery,key,scope),'REQUEUED');
  assert.equal(reconciles,1);

  const persisted=await db.query<{
   delivery_state:string;intent_state:string;
   attempt_count:number;attempts:number;
  }>(`SELECT d.state AS delivery_state,n.state AS intent_state,
   d.attempt_count,n.attempts FROM notification_deliveries d
   JOIN notification_intents n ON n.id=d.intent_id WHERE d.id=$1`,[delivery]);
  assert.deepEqual(persisted.rows,[{
   delivery_state:'PENDING',intent_state:'PENDING',attempt_count:0,attempts:0,
  }]);
  const audit=await db.query<{delivery_id:string;intent_id:string;actor_staff_id:string;requeue_key:string}>(`
   SELECT delivery_id::text,intent_id::text,actor_staff_id::text,requeue_key::text
   FROM notification_requeue_audit WHERE requeue_key=$1`,[key]);
  assert.deepEqual(audit.rows,[{
   delivery_id:delivery,intent_id:intent,actor_staff_id:staff,requeue_key:key,
  }]);

  // Client retry after the first transaction is already committed to PENDING.
  assert.equal(await requeueFailedOrganizationDelivery(
   database as never,provider,token,pepper,delivery,key,scope),'ALREADY_REQUEUED');
  assert.equal(reconciles,1);
  assert.equal(await requeueFailedOrganizationDelivery(
   database as never,provider,token,pepper,delivery,randomUUID(),scope),'DENIED');
  assert.equal(reconciles,1);
  const count=await db.query<{count:string}>(`
   SELECT count(*)::text AS count FROM notification_requeue_audit WHERE delivery_id=$1`,
   [delivery]);
  assert.equal(count.rows[0].count,'1');

  // The audit must be append-only at the database boundary, not just in TS.
  await db.query('SAVEPOINT audit_immutability');
  await assert.rejects(db.query(`
   UPDATE notification_requeue_audit SET requeue_key=$2 WHERE requeue_key=$1
  `,[key,randomUUID()]),/notification requeue audit is append-only/);
  await db.query('ROLLBACK TO SAVEPOINT audit_immutability');
  await db.query('SAVEPOINT audit_immutability');
  await assert.rejects(db.query(`
   DELETE FROM notification_requeue_audit WHERE requeue_key=$1
  `,[key]),/notification requeue audit is append-only/);
  await db.query('ROLLBACK TO SAVEPOINT audit_immutability');
 }finally{
  await db.query('ROLLBACK').catch(()=>{});
  await db.end();
 }
});
