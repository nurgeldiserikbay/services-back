import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Client} from 'pg';
import {readSellerInbox} from '../src/modules/requests/seller-inbox.repository.js';
import {parseSellerInboxFilter} from '../src/modules/requests/seller-inbox.contract.js';
import {resolveSellerDecisionAuthority} from '../src/modules/requests/seller-authority.js';
import {decideSellerRequest,SellerDecisionRejected} from '../src/modules/requests/seller-decision.transaction.js';

async function fixture(db:Client){
 const ownerId=randomUUID(),personId=randomUUID(),profileId=randomUUID();
 const professionId=randomUUID(),definitionId=randomUUID(),offerId=randomUUID();
 const requestId=randomUUID(),guestId=randomUUID();
 await db.query('INSERT INTO users(id) VALUES($1)',[ownerId]);
 await db.query('INSERT INTO persons(id,user_id) VALUES($1,$2)',[personId,ownerId]);
 await db.query('INSERT INTO professions(id,code,name) VALUES($1,$2,$3)',
   [professionId,'inbox-prof-'+randomUUID(),'Inbox profession']);
 await db.query(`INSERT INTO professional_profiles(
    id,person_id,profession_id,slug,status)
    VALUES($1,$2,$3,$4,'PUBLISHED')`,
   [profileId,personId,professionId,'inbox-prof-'+randomUUID()]);
 await db.query('INSERT INTO service_definitions(id,code,name) VALUES($1,$2,$3)',
   [definitionId,'inbox-service-'+randomUUID(),'Inbox service']);
 await db.query(`INSERT INTO service_offers(
    id,definition_id,professional_id,title,status,delivery_mode,contacts)
    VALUES($1,$2,$3,'Private test offer','PUBLISHED','online','{}'::jsonb)`,
   [offerId,definitionId,profileId]);
 await db.query(`INSERT INTO guest_contacts(
    id,channel,encrypted_value,digest,expires_at)
    VALUES($1,'email','encrypted',$2,now()+interval '1 day')`,
   [guestId,'inbox-guest-'+randomUUID()]);
 await db.query(`INSERT INTO service_requests(
   id,offer_id,guest_contact_id,source_context,seller_professional_id,status,note)
   VALUES($1,$2,$3,'PERSONAL',$4,'PENDING','private note')`,
  [requestId,offerId,guestId,profileId]);
 return {ownerId,profileId,requestId};
}

test('personal inbox and decision permission agree across profile lifecycle',async()=>{
 const db=new Client({connectionString:process.env.DATABASE_URL});
 await db.connect();await db.query('BEGIN');
 try{
  const f=await fixture(db);
  const filter=parseSellerInboxFilter({state:'pending'});
  const visible=()=>readSellerInbox(db,f.ownerId,filter);
  const allowed=()=>resolveSellerDecisionAuthority(db,f.ownerId,f.requestId);
  assert.deepEqual((await visible()).items.map(x=>x.id),[f.requestId]);
  assert.equal((await allowed()).authorized,true);
  for(const state of ['PAUSED','DRAFT','ARCHIVED'] as const){
   await db.query('UPDATE professional_profiles SET status=$2::"ProfileStatus" WHERE id=$1',
     [f.profileId,state]);
   assert.deepEqual((await visible()).items,[],state);
   assert.deepEqual(await allowed(),{authorized:false},state);
  }
  await db.query(`UPDATE professional_profiles SET status='PUBLISHED' WHERE id=$1`,
   [f.profileId]);
  assert.deepEqual((await visible()).items.map(x=>x.id),[f.requestId]);
  assert.equal((await allowed()).authorized,true);
  // Another account must not gain decision rights merely by knowing the request ID.
  assert.deepEqual(await resolveSellerDecisionAuthority(db,randomUUID(),f.requestId),
    {authorized:false});
  await db.query(`UPDATE users SET status='SUSPENDED' WHERE id=$1`,[f.ownerId]);
  assert.deepEqual((await visible()).items,[]);
  assert.deepEqual(await allowed(),{authorized:false});
  // Restoring the owner must restore both read and decision permissions.
  await db.query(`UPDATE users SET status='ACTIVE' WHERE id=$1`,[f.ownerId]);
  assert.deepEqual((await visible()).items.map(x=>x.id),[f.requestId]);
  assert.equal((await allowed()).authorized,true);
 }finally{await db.query('ROLLBACK').catch(()=>{});await db.end();}
});

test('personal inbox exposes neither private note nor guest contact',async()=>{
 const db=new Client({connectionString:process.env.DATABASE_URL});
 await db.connect();await db.query('BEGIN');
 try{
  const f=await fixture(db);
  const page=await readSellerInbox(db,f.ownerId,parseSellerInboxFilter({}));
  assert.equal(page.items.length,1);
  assert.equal(page.items[0].seller_kind,'professional');
  assert.equal(page.items[0].seller_id,f.profileId);
  assert.doesNotMatch(JSON.stringify(page),/private note|inbox-guest|encrypted/);
  const strangerId=randomUUID();
  assert.deepEqual((await readSellerInbox(db,strangerId,
    parseSellerInboxFilter({}))).items,[]);
  assert.deepEqual(await resolveSellerDecisionAuthority(db,strangerId,f.requestId),
    {authorized:false});
 }finally{await db.query('ROLLBACK').catch(()=>{});await db.end();}
});

test('seller request isolation survives owner suspension and reinstatement',async()=>{
 const db=new Client({connectionString:process.env.DATABASE_URL});
 await db.connect();await db.query('BEGIN');
 try{
  const a=await fixture(db),b=await fixture(db);
  const filter=parseSellerInboxFilter({state:'pending'});
  const ids=async(userId:string)=>(await readSellerInbox(db,userId,filter)).items.map(x=>x.id);
  assert.deepEqual(await ids(a.ownerId),[a.requestId]);
  assert.deepEqual(await ids(b.ownerId),[b.requestId]);
  assert.deepEqual(await resolveSellerDecisionAuthority(db,a.ownerId,b.requestId),
    {authorized:false});
  assert.deepEqual(await resolveSellerDecisionAuthority(db,b.ownerId,a.requestId),
    {authorized:false});
  await db.query("UPDATE users SET status='SUSPENDED' WHERE id=$1",[a.ownerId]);
  assert.deepEqual(await ids(a.ownerId),[]);
  assert.deepEqual(await ids(b.ownerId),[b.requestId]);
  assert.deepEqual(await resolveSellerDecisionAuthority(db,a.ownerId,a.requestId),
    {authorized:false});
  await db.query("UPDATE users SET status='ACTIVE' WHERE id=$1",[a.ownerId]);
  assert.deepEqual(await ids(a.ownerId),[a.requestId]);
  assert.deepEqual(await ids(b.ownerId),[b.requestId]);
  assert.deepEqual(await resolveSellerDecisionAuthority(db,a.ownerId,b.requestId),
    {authorized:false});
 }finally{await db.query('ROLLBACK').catch(()=>{});await db.end();}
});

test('seller decision persists exactly one request event, outbox and guest notification in PostgreSQL',async()=>{
 const db=new Client({connectionString:process.env.DATABASE_URL});
 await db.connect();await db.query('BEGIN');
 try{
  const f=await fixture(db);
  await db.query(`UPDATE guest_contacts SET verified_at=now()
    WHERE id=(SELECT guest_contact_id FROM service_requests WHERE id=$1)`,[f.requestId]);
  const authority=await resolveSellerDecisionAuthority(db,f.ownerId,f.requestId);
  assert.equal(authority.authorized,true);
  if(!authority.authorized)throw new Error('fixture authorization failed');
  const decision=await decideSellerRequest(db,f.requestId,authority.seller,'accept',1);
  assert.deepEqual(decision,{id:f.requestId,state:'accepted',version:2,replayed:false});
  const state=await db.query(
   'SELECT status::text,version FROM service_requests WHERE id=$1',[f.requestId]);
  assert.equal(state.rows[0].status,'ACCEPTED');
  assert.equal(state.rows[0].version,2);
  const events=await db.query(
   'SELECT kind::text FROM service_request_events WHERE request_id=$1',[f.requestId]);
  assert.equal(events.rows.length,1);
  assert.equal(events.rows[0].kind,'ACCEPTED');
  const outbox=await db.query(
   "SELECT id,topic,safe_payload FROM domain_outbox_events WHERE subject_kind='ServiceRequest' AND subject_id=$1",
   [f.requestId]);
  assert.equal(outbox.rows.length,1);
  assert.equal(outbox.rows[0].topic,'service_request.accepted');
  assert.deepEqual(outbox.rows[0].safe_payload,{});
  const notifications=await db.query(
   'SELECT channel::text,guest_contact_id,recipient_person_id FROM notification_intents WHERE domain_event_id=$1',
   [outbox.rows[0].id]);
  assert.equal(notifications.rows.length,1);
  assert.equal(notifications.rows[0].channel,'EMAIL');
  assert.equal(notifications.rows[0].recipient_person_id,null);
  await assert.rejects(decideSellerRequest(db,f.requestId,authority.seller,'decline',2),
   (error:unknown)=>error instanceof SellerDecisionRejected&&error.reason==='conflict');
  const after=await db.query(
   'SELECT count(*)::int AS count FROM service_request_events WHERE request_id=$1',[f.requestId]);
  assert.equal(after.rows[0].count,1);
 }finally{await db.query('ROLLBACK').catch(()=>{});await db.end();}
});

test('failed notification insert rolls back seller decision and outbox in PostgreSQL',async()=>{
 const db=new Client({connectionString:process.env.DATABASE_URL});
 await db.connect();await db.query('BEGIN');
 try{
  const f=await fixture(db);
  await db.query(`UPDATE guest_contacts SET verified_at=now()
    WHERE id=(SELECT guest_contact_id FROM service_requests WHERE id=$1)`,[f.requestId]);
  const authority=await resolveSellerDecisionAuthority(db,f.ownerId,f.requestId);
  assert.equal(authority.authorized,true);
  if(!authority.authorized)throw new Error('fixture authorization failed');
  await db.query('SAVEPOINT before_decision');
  // A transaction-local trigger simulates a notification storage failure.
  await db.query(`CREATE FUNCTION pg_temp.reject_notification_insert()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'test_notification_failure'; END $$`);
  await db.query(`CREATE TRIGGER test_reject_notification_insert
    BEFORE INSERT ON notification_intents FOR EACH ROW
    EXECUTE FUNCTION pg_temp.reject_notification_insert()`);
  await assert.rejects(decideSellerRequest(db,f.requestId,authority.seller,'accept',1),
   /test_notification_failure/);
  // PostgreSQL transactions are aborted on statement failure; caller must roll back.
  await db.query('ROLLBACK TO SAVEPOINT before_decision');
  const state=await db.query(
   'SELECT status::text,version FROM service_requests WHERE id=$1',[f.requestId]);
  assert.equal(state.rows[0].status,'PENDING');
  assert.equal(state.rows[0].version,1);
  const events=await db.query(
   'SELECT count(*)::int AS count FROM service_request_events WHERE request_id=$1',[f.requestId]);
  assert.equal(events.rows[0].count,0);
  const outbox=await db.query(
   "SELECT count(*)::int AS count FROM domain_outbox_events WHERE subject_kind='ServiceRequest' AND subject_id=$1",
   [f.requestId]);
  assert.equal(outbox.rows[0].count,0);
 }finally{await db.query('ROLLBACK').catch(()=>{});await db.end();}
});

test('declined guest request creates one durable notification and rejects replay',async()=>{
 const db=new Client({connectionString:process.env.DATABASE_URL});
 await db.connect();await db.query('BEGIN');
 try{
  const f=await fixture(db);
  await db.query(`UPDATE guest_contacts SET verified_at=now()
    WHERE id=(SELECT guest_contact_id FROM service_requests WHERE id=$1)`,[f.requestId]);
  const authority=await resolveSellerDecisionAuthority(db,f.ownerId,f.requestId);
  assert.equal(authority.authorized,true);
  if(!authority.authorized)throw new Error('fixture authorization failed');
  const result=await decideSellerRequest(db,f.requestId,authority.seller,'decline',1);
  assert.deepEqual(result,{id:f.requestId,state:'declined',version:2,replayed:false});
  const notifications=await db.query(`
   SELECT n.channel,n.dedupe_key,n.guest_contact_id,o.topic
   FROM notification_intents n
   JOIN domain_outbox_events o ON o.id=n.domain_event_id
   WHERE o.subject_kind='ServiceRequest' AND o.subject_id=$1`,[f.requestId]);
  assert.equal(notifications.rows.length,1);
  assert.equal(notifications.rows[0].channel,'EMAIL');
  assert.equal(notifications.rows[0].topic,'service_request.declined');
  assert.equal(notifications.rows[0].dedupe_key,'request-decline:guest:'+f.requestId);
  await assert.rejects(decideSellerRequest(db,f.requestId,authority.seller,'accept',1),
   (error:unknown)=>error instanceof SellerDecisionRejected&&error.reason==='conflict');
  const after=await db.query(`
   SELECT count(*)::int AS count FROM notification_intents n
   JOIN domain_outbox_events o ON o.id=n.domain_event_id
   WHERE o.subject_kind='ServiceRequest' AND o.subject_id=$1`,[f.requestId]);
  assert.equal(after.rows[0].count,1);
 }finally{await db.query('ROLLBACK').catch(()=>{});await db.end();}
});

test('expired or unverified guest contact cannot trigger seller transition or outbox',async()=>{
 const db=new Client({connectionString:process.env.DATABASE_URL});
 await db.connect();await db.query('BEGIN');
 try{
  const f=await fixture(db);
  const authority=await resolveSellerDecisionAuthority(db,f.ownerId,f.requestId);
  assert.equal(authority.authorized,true);
  if(!authority.authorized)throw new Error('fixture authorization failed');
  const contact=await db.query(
   'SELECT guest_contact_id FROM service_requests WHERE id=$1',[f.requestId]);
  const guestId=contact.rows[0].guest_contact_id;
  for(const state of ['unverified','expired'] as const){
   await db.query(`UPDATE guest_contacts SET
     verified_at=CASE WHEN $2='expired' THEN now() ELSE NULL END,
     expires_at=CASE WHEN $2='expired' THEN now()-interval '1 minute'
                     ELSE now()+interval '1 day' END
     WHERE id=$1`,[guestId,state]);
   await assert.rejects(decideSellerRequest(db,f.requestId,authority.seller,'accept',1),
    (error:unknown)=>error instanceof SellerDecisionRejected&&error.reason==='conflict');
   const row=await db.query(
    'SELECT status::text,version FROM service_requests WHERE id=$1',[f.requestId]);
   assert.deepEqual([row.rows[0].status,row.rows[0].version],['PENDING',1]);
   const events=await db.query(
    'SELECT count(*)::int AS count FROM service_request_events WHERE request_id=$1',
    [f.requestId]);
   assert.equal(events.rows[0].count,0);
   const outbox=await db.query(`
    SELECT count(*)::int AS count FROM domain_outbox_events
    WHERE subject_kind='ServiceRequest' AND subject_id=$1`,[f.requestId]);
   assert.equal(outbox.rows[0].count,0);
  }
 }finally{await db.query('ROLLBACK').catch(()=>{});await db.end();}
});

test('registered customer acceptance stores IN_APP notification without guest recipient',async()=>{
 const db=new Client({connectionString:process.env.DATABASE_URL});
 await db.connect();await db.query('BEGIN');
 try{
  const f=await fixture(db);
  const person=await db.query(
   'SELECT person_id FROM professional_profiles WHERE id=$1',[f.profileId]);
  const customerUserId=randomUUID(),customerPersonId=randomUUID();
  await db.query('INSERT INTO users(id) VALUES($1)',[customerUserId]);
  await db.query('INSERT INTO persons(id,user_id) VALUES($1,$2)',
   [customerPersonId,customerUserId]);
  assert.notEqual(customerPersonId,person.rows[0].person_id);
  await db.query(`UPDATE service_requests
   SET guest_contact_id=NULL,customer_person_id=$2 WHERE id=$1`,
   [f.requestId,customerPersonId]);
  const authority=await resolveSellerDecisionAuthority(db,f.ownerId,f.requestId);
  assert.equal(authority.authorized,true);
  if(!authority.authorized)throw new Error('fixture authorization failed');
  const result=await decideSellerRequest(db,f.requestId,authority.seller,'accept',1);
  assert.equal(result.state,'accepted');
  const notification=await db.query(`
   SELECT n.channel,n.recipient_person_id,n.guest_contact_id,n.dedupe_key
   FROM notification_intents n
   JOIN domain_outbox_events o ON o.id=n.domain_event_id
   WHERE o.subject_kind='ServiceRequest' AND o.subject_id=$1`,[f.requestId]);
  assert.equal(notification.rows.length,1);
  assert.equal(notification.rows[0].channel,'IN_APP');
  assert.equal(notification.rows[0].recipient_person_id,customerPersonId);
  assert.equal(notification.rows[0].guest_contact_id,null);
  assert.equal(notification.rows[0].dedupe_key,
   'request-accept:client:'+f.requestId);
 }finally{await db.query('ROLLBACK').catch(()=>{});await db.end();}
});

test('cross-tenant seller decision is denied before any event or notification write',async()=>{
 const db=new Client({connectionString:process.env.DATABASE_URL});
 await db.connect();await db.query('BEGIN');
 try{
  const owner=await fixture(db),other=await fixture(db);
  await db.query(`UPDATE guest_contacts SET verified_at=now()
    WHERE id=(SELECT guest_contact_id FROM service_requests WHERE id=$1)`,
   [owner.requestId]);
  await assert.rejects(
   decideSellerRequest(db,owner.requestId,
    {kind:'professional',sellerId:other.profileId},'accept',1),
   (error:unknown)=>error instanceof SellerDecisionRejected&&error.reason==='forbidden');
  const state=await db.query(
   'SELECT status::text,version FROM service_requests WHERE id=$1',[owner.requestId]);
  assert.deepEqual([state.rows[0].status,state.rows[0].version],['PENDING',1]);
  const events=await db.query(
   'SELECT count(*)::int AS n FROM service_request_events WHERE request_id=$1',
   [owner.requestId]);
  const outbox=await db.query(
   `SELECT count(*)::int AS n FROM domain_outbox_events
    WHERE subject_kind='ServiceRequest' AND subject_id=$1`,[owner.requestId]);
  assert.equal(events.rows[0].n,0);
  assert.equal(outbox.rows[0].n,0);
  const notifications=await db.query(`
   SELECT count(*)::int AS n FROM notification_intents n
   JOIN domain_outbox_events o ON o.id=n.domain_event_id
   WHERE o.subject_kind='ServiceRequest' AND o.subject_id=$1`,[owner.requestId]);
  assert.equal(notifications.rows[0].n,0);
 }finally{await db.query('ROLLBACK').catch(()=>{});await db.end();}
});
