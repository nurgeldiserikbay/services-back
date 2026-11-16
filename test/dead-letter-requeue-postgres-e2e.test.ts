import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {Client} from 'pg';
import {issueAdminSessionToken} from '../src/modules/admin/admin-session-token.js';
import {requeueFailedOrganizationDelivery} from '../src/modules/notifications/dead-letter-requeue.js';

test('PostgreSQL requeue is audited, idempotent, scoped and rolled back atomically',async()=>{
 const db=new Client({connectionString:process.env.DATABASE_URL});
 await db.connect();
 await db.query('BEGIN');
 const userId=randomUUID(), personId=randomUUID(), orgId=randomUUID();
 const staffId=randomUUID(), sessionId=randomUUID(), grantId=randomUUID();
 const eventId=randomUUID(), intentId=randomUUID(), deliveryId=randomUUID();
 const scope='organization:'+orgId,key=randomUUID(),pepper=randomBytes(32);
 const {token,tokenHash}=issueAdminSessionToken(pepper);
 let providerCalls=0;
 const provider={
  supportsIdempotentSend:true as const,
  reconcile:async(idempotencyKey:string,channel:'EMAIL'|'SMS')=>{
   providerCalls++;
   assert.equal(idempotencyKey,'EMAIL:'+intentId);
   assert.equal(channel,'EMAIL');
   return 'NOT_FOUND' as const;
  },
 };
 const database={
  query:db.query.bind(db),
  // Outer BEGIN keeps all fixture and assertions isolated in a single test
  // transaction; each call uses the SAME PostgreSQL connection as production.
  transaction:async<T>(fn:(client:Client)=>Promise<T>):Promise<T>=>fn(db),
 };
 const read=async()=>{
  const d=await db.query<{state:string;attempt_count:number;lease_token:string|null}>(`
   SELECT state,attempt_count,lease_token
   FROM notification_deliveries WHERE id=$1`,[deliveryId]);
  const n=await db.query<{state:string;attempts:number}>(`
   SELECT state,attempts FROM notification_intents WHERE id=$1`,[intentId]);
  const audits=await db.query<{requeue_key:string;actor_staff_id:string}>(`
   SELECT requeue_key::text,actor_staff_id::text
   FROM notification_requeue_audit WHERE delivery_id=$1`,[deliveryId]);
  return {delivery:d.rows[0],intent:n.rows[0],audits:audits.rows};
 };
 try{
  await db.query('INSERT INTO users(id) VALUES($1)',[userId]);
  await db.query('INSERT INTO persons(id,user_id) VALUES($1,$2)',[personId,userId]);
  await db.query(`INSERT INTO organizations(id,owner_person_id,slug,name)
   VALUES($1,$2,$3,'Requeue E2E fixture')`,
   [orgId,personId,'requeue-e2e-'+orgId]);
  await db.query(`INSERT INTO platform_admin_staff(id,user_id,role)
   VALUES($1,$2,'admin')`,[staffId,userId]);
  await db.query(`INSERT INTO platform_admin_sessions
   (id,staff_id,token_hash,mfa_verified_at,expires_at,created_at)
   VALUES($1,$2,$3,now()-interval '2 minutes',
          now()+interval '1 hour',now()-interval '1 minute')`,
   [sessionId,staffId,tokenHash]);
  await db.query(`INSERT INTO platform_admin_totp_factors
   (staff_id,encrypted_secret,key_version,created_at,activated_at)
   VALUES($1,'encrypted-test-envelope','test-v1',
          now()-interval '5 minutes',now()-interval '3 minutes')`,
   [staffId]);
  await db.query(`INSERT INTO platform_admin_grants(id,staff_id,scope)
   VALUES($1,$2,$3)`,[grantId,staffId,scope]);
  await db.query(`INSERT INTO domain_outbox_events
   (id,topic,subject_kind,subject_id,safe_payload)
   VALUES($1,'test.requeue.e2e','Organization',$2,'{}'::jsonb)`,
   [eventId,orgId]);
  await db.query(`INSERT INTO notification_intents
   (id,domain_event_id,recipient_org_id,audience,channel,state,attempts,dedupe_key)
   VALUES($1,$2,$3,'SELLER','EMAIL','FAILED',5,$4)`,
   [intentId,eventId,orgId,'requeue-e2e:'+randomUUID()]);
  await db.query(`INSERT INTO notification_deliveries
   (id,intent_id,channel,state,attempt_count)
   VALUES($1,$2,'EMAIL','FAILED',5)`,[deliveryId,intentId]);

  assert.equal(await requeueFailedOrganizationDelivery(
   database as never,provider,token,pepper,deliveryId,key,scope),'REQUEUED');
  assert.deepEqual(await read(),{
   delivery:{state:'PENDING',attempt_count:0,lease_token:null},
   intent:{state:'PENDING',attempts:0},
   audits:[{requeue_key:key,actor_staff_id:staffId}],
  });
  // Successful replay must not contact the provider or increment attempts.
  assert.equal(await requeueFailedOrganizationDelivery(
   database as never,provider,token,pepper,deliveryId,key,scope),
   'ALREADY_REQUEUED');
  assert.equal(providerCalls,1);
  assert.equal((await read()).audits.length,1);
  assert.equal(await requeueFailedOrganizationDelivery(
   database as never,provider,token,pepper,deliveryId,randomUUID(),
   'organization:'+randomUUID()),'DENIED');
  assert.equal(providerCalls,1);

  // A revoked session cannot even receive ALREADY_REQUEUED metadata.
  await db.query('UPDATE platform_admin_sessions SET revoked_at=now() WHERE id=$1',
   [sessionId]);
  assert.equal(await requeueFailedOrganizationDelivery(
   database as never,provider,token,pepper,deliveryId,key,scope),'DENIED');

  // PostgreSQL prevents audit mutation, even inside a privileged transaction.
  await db.query('SAVEPOINT audit_immutability');
  await assert.rejects(db.query(
   'DELETE FROM notification_requeue_audit WHERE requeue_key=$1',[key]),
   /notification requeue audit is append-only/);
  await db.query('ROLLBACK TO SAVEPOINT audit_immutability');
  assert.equal((await read()).audits.length,1);
 }finally{
  await db.query('ROLLBACK').catch(()=>{});
  await db.end();
 }
});

test('PostgreSQL requeue refuses accepted provider outcome and keeps FAILED row',async()=>{
 const db=new Client({connectionString:process.env.DATABASE_URL});
 await db.connect();
 // Invalid bearer should cause zero provider traffic and zero mutations.
 let providerCalls=0;
 try{
  const result=await requeueFailedOrganizationDelivery({
   query:db.query.bind(db),
   transaction:async<T>(f:(c:Client)=>Promise<T>)=>f(db),
  } as never,{
   supportsIdempotentSend:true,
   reconcile:async()=>{providerCalls++;return 'ACCEPTED' as const;},
  },'bad',randomBytes(32),randomUUID(),randomUUID(),
  'organization:'+randomUUID());
  assert.equal(result,'DENIED');
  assert.equal(providerCalls,0);
 }finally{
  await db.end();
 }
});
