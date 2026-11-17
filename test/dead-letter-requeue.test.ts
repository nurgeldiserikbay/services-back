import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {issueAdminSessionToken} from '../src/modules/admin/admin-session-token.js';
import {requeueFailedOrganizationDelivery}
 from '../src/modules/notifications/dead-letter-requeue.js';

const pepper=randomBytes(32);
const bearer=issueAdminSessionToken(pepper).token;
const userId=randomUUID(),staffId=randomUUID(),orgId=randomUUID();
const scope='organization:'+orgId;
const deliveryId=randomUUID(),intentId=randomUUID();
const now=Date.now();

function fixture(role:'owner'|'admin'|'operator'|'auditor'='owner',
 auditDeliveryId:string|null=null){
 const queries:string[]=[];
 let updates=0,audits=0,providerCalls=0,transactions=0;
 let revoked=false;
 const db={
  query:async(sql:string)=>{
   queries.push(sql);
   if(sql.includes('SELECT usr.id::text AS user_id')){
    return {rows:[{
     user_id:userId,role,expires_at:new Date(now+60000),
     mfa_verified_at:new Date(now-1000),scope,
    }]};
   }
   if(sql.includes('SELECT a.delivery_id::text'))
    return {rows:auditDeliveryId===null?[]:[{delivery_id:auditDeliveryId}]};
   if(sql.includes('SELECT n.id::text AS intent_id,d.channel,d.attempt_count'))
    return {rows:[{intent_id:intentId,channel:'EMAIL',
     attempt_count:5,intent_attempts:5}]};
   if(sql.includes('SELECT n.id::text AS intent_id,d.channel'))
    return {rows:[{intent_id:intentId,channel:'EMAIL'}]};
   if(sql.includes('SELECT staff.id::text AS staff_id'))
    return {rows:revoked?[]:[{staff_id:staffId}]};
   if(sql.includes('SELECT delivery_id::text FROM notification_requeue_audit'))
    return {rows:auditDeliveryId===null?[]:[{delivery_id:auditDeliveryId}]};

   if(sql.includes('UPDATE notification_deliveries')||
      sql.includes('UPDATE notification_intents')){
    updates++;
    return {rows:[{id:sql.includes('UPDATE notification_intents')?intentId:deliveryId}]};
   }
   if(sql.includes('INSERT INTO notification_requeue_audit')){
    audits++;
    return {rows:[{id:randomUUID()}]};
   }
   throw new Error('unexpected SQL');
  },
  transaction:async<T>(work:(client:never)=>Promise<T>):Promise<T>=>{
   transactions++;
   return work(db as never);
  },
 };
 const provider={
  supportsIdempotentSend:true as const,
  reconcile:async(key:string,channel:string)=>{
   providerCalls++;
   assert.equal(key,'EMAIL:'+intentId);
   assert.equal(channel,'EMAIL');
   return 'NOT_FOUND' as 'NOT_FOUND'|'ACCEPTED'|'UNKNOWN';
  },
 };
 const counts=()=>({updates,audits,providerCalls,transactions,queries});
 return {db,provider,counts,revoke:()=>{revoked=true;}};
}

test('unauthorized roles and invalid keys deny before provider contact',async()=>{
 for(const role of ['operator','auditor'] as const){
  const {db,provider,counts}=fixture(role);
  assert.equal(await requeueFailedOrganizationDelivery(db as never,provider,
   bearer,pepper,deliveryId,randomUUID(),scope,now),'DENIED');
  assert.equal(counts().providerCalls,0);
  assert.equal(counts().updates,0);
 }
 const {db,provider,counts}=fixture('owner');
 assert.equal(await requeueFailedOrganizationDelivery(db as never,provider,
  bearer,pepper,'bad',randomUUID(),scope,now),'DENIED');
 assert.equal(await requeueFailedOrganizationDelivery(db as never,provider,
  bearer,pepper,deliveryId,'bad',scope,now),'DENIED');
 assert.equal(counts().queries.length,0);
});

test('authorized scoped requeue is recorded with audit in transaction',async()=>{
 const {db,provider,counts}=fixture('owner');
 const key=randomUUID();
 assert.equal(await requeueFailedOrganizationDelivery(db as never,provider,
  bearer,pepper,deliveryId,key,scope,now),'REQUEUED');
 assert.equal(counts().providerCalls,1);
 assert.equal(counts().transactions,1);
 assert.equal(counts().updates,2);
 assert.equal(counts().audits,1);
 assert.ok(counts().queries.some(q=>q.includes('FOR UPDATE OF d,n')));
 assert.ok(counts().queries.some(q=>q.includes('FOR SHARE OF session,staff,usr,grants')));
 assert.ok(counts().queries.some(q=>q.includes('INSERT INTO notification_requeue_audit')));
});

test('requeue request key cannot acknowledge another delivery',async()=>{
 const {db,provider,counts}=fixture('owner',randomUUID());
 assert.equal(await requeueFailedOrganizationDelivery(db as never,provider,
  bearer,pepper,deliveryId,randomUUID(),scope,now),'DENIED');
 assert.equal(counts().updates,0);
 assert.equal(counts().audits,0);
 const prior=fixture('owner',deliveryId);
 assert.equal(await requeueFailedOrganizationDelivery(
  prior.db as never,prior.provider,bearer,pepper,
  deliveryId,randomUUID(),scope,now),'ALREADY_REQUEUED');
 assert.equal(prior.counts().updates,0);
 assert.equal(prior.counts().providerCalls,0);
 assert.equal(prior.counts().transactions,0);
 assert.equal(prior.counts().queries.some(q=>q.includes(
  'SELECT n.id::text AS intent_id,d.channel')),false);
});

test('replayed audit key is recognized without requiring FAILED state',async()=>{
 const {db,provider,counts}=fixture('admin',deliveryId);
 // A successful prior requeue moved the row to PENDING, so any subsequent
 // terminal-state lookup must be skipped entirely.
 assert.equal(await requeueFailedOrganizationDelivery(
  db as never,provider,bearer,pepper,deliveryId,randomUUID(),scope,now),
  'ALREADY_REQUEUED');
 assert.equal(counts().providerCalls,0);
 assert.equal(counts().transactions,0);
 assert.equal(counts().queries.some(q=>q.includes(
  'SELECT n.id::text AS intent_id,d.channel')),false);
});

test('provider uncertainty never requeues failed delivery',async()=>{
 for(const verdict of ['ACCEPTED','UNKNOWN'] as const){
  const {db,provider,counts}=fixture();
  provider.reconcile=async()=>verdict;
  assert.equal(await requeueFailedOrganizationDelivery(db as never,provider,
   bearer,pepper,deliveryId,randomUUID(),scope,now),'UNCERTAIN');
  assert.equal(counts().transactions,0);
  assert.equal(counts().updates,0);
  assert.equal(counts().audits,0);
 }
});

test('revalidation of revoked grant denies write after reconciliation',async()=>{
 const {db,provider,counts,revoke}=fixture('admin');
 const reconcile=async()=>{revoke();return 'NOT_FOUND' as const;};
 assert.equal(await requeueFailedOrganizationDelivery(db as never,
  {...provider,reconcile},bearer,pepper,deliveryId,randomUUID(),scope,now),
  'DENIED');
 assert.equal(counts().updates,0);
 assert.equal(counts().audits,0);
});

test('unsupported provider fails closed before SQL',async()=>{
 const {db,provider,counts}=fixture();
 await assert.rejects(requeueFailedOrganizationDelivery(db as never,
  {...provider,supportsIdempotentSend:false as never},bearer,pepper,
  deliveryId,randomUUID(),scope,now),/external_provider_idempotency_required/);
 assert.equal(counts().queries.length,0);
});

test('malformed prior audit identity fails closed before provider contact',async()=>{
 for(const recorded of ['invalid',42]){
  const {db,provider,counts}=fixture('owner',recorded as never);
  await assert.rejects(requeueFailedOrganizationDelivery(
   db as never,provider,bearer,pepper,deliveryId,randomUUID(),scope,now),
   /notification_dead_letter_audit_conflict/);
  assert.equal(counts().providerCalls,0);
  assert.equal(counts().transactions,0);
  assert.equal(counts().updates,0);
 }
});

test('requeue update row identity mismatch must not be reported successful',async()=>{
 for(const corrupted of ['delivery','intent']){
  const {db,provider,counts}=fixture();
  const original=db.query;
  db.query=async(sql:string)=>{
   const response=await original(sql);
   if((corrupted==='delivery'&&sql.includes('UPDATE notification_deliveries'))||
      (corrupted==='intent'&&sql.includes('UPDATE notification_intents')))
    return {rows:[{id:randomUUID()}]};
   return response;
  };
  await assert.rejects(requeueFailedOrganizationDelivery(
   db as never,provider,bearer,pepper,deliveryId,randomUUID(),scope,now),
   /notification_dead_letter_conflict/);
  assert.equal(counts().audits,0);
 }
});
