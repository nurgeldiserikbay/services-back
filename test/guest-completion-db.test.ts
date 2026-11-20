import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {Client} from 'pg';
import {hashGuestCapability,issueGuestCapability} from
 '../src/modules/guest-requests/guest-request.security.js';
import {confirmGuestRequestCompletion,GuestCompletionRejected} from
 '../src/modules/requests/guest-completion.transaction.js';

async function fixture(
 action:(db:Client,f:{id:string;contact:string;org:string;
  token:string;pepper:Buffer;capability:string})=>Promise<void>,
 status:'ACCEPTED'|'PENDING'='ACCEPTED',
){
 if(!process.env.DATABASE_URL)throw Error('DATABASE_URL required');
 const db=new Client({connectionString:process.env.DATABASE_URL});
 await db.connect();await db.query('BEGIN');
 try{
  const ownerUser=randomUUID(),ownerPerson=randomUUID(),org=randomUUID();
  const definition=randomUUID(),offer=randomUUID(),contact=randomUUID();
  const id=randomUUID(),capability=randomUUID(),pepper=randomBytes(32);
  const proof=issueGuestCapability('COMPLETE_REQUEST',pepper);
  await db.query('INSERT INTO users(id) VALUES($1)',[ownerUser]);
  await db.query('INSERT INTO persons(id,user_id) VALUES($1,$2)',[ownerPerson,ownerUser]);
  await db.query(`INSERT INTO organizations(id,owner_person_id,slug,name,status)
   VALUES($1,$2,$3,'CI guest completion','ACTIVE')`,
   [org,ownerPerson,'guest-completion-'+randomUUID()]);
  await db.query(`INSERT INTO service_definitions(id,code,name)
   VALUES($1,$2,'Guest completion fixture')`,
   [definition,'guest-completion-'+randomUUID()]);
  await db.query(`INSERT INTO service_offers
   (id,definition_id,organization_id,title,status,delivery_mode,contacts)
   VALUES($1,$2,$3,'Guest completion offer','PUBLISHED','online','{}'::jsonb)`,
   [offer,definition,org]);
  await db.query(`INSERT INTO guest_contacts
   (id,channel,encrypted_value,digest,verified_at,expires_at)
   VALUES($1,'email','opaque encrypted',$2,now(),now()+interval '1 day')`,
   [contact,'guest-completion-'+randomUUID()]);
  await db.query(`INSERT INTO service_requests
   (id,offer_id,guest_contact_id,source_context,seller_organization_id,
    status,accepted_at,note)
   VALUES($1,$2,$3,'ORGANIZATION',$4,$5::"RequestStatus",
    CASE WHEN $5='ACCEPTED' THEN now() ELSE NULL END,'SECRET NEVER EXPORTED')`,
   [id,offer,contact,org,status]);
  await db.query(`INSERT INTO guest_capabilities
   (id,guest_contact_id,request_id,scope,token_hash,expires_at)
   VALUES($1,$2,$3,'COMPLETE_REQUEST',$4,now()+interval '10 minutes')`,
   [capability,contact,id,proof.tokenHash]);
  await action(db,{id,contact,org,token:proof.token,pepper,capability});
 }finally{
  await db.query('ROLLBACK').catch(()=>{});
  await db.end();
 }
}
const reject=(reason:'not_found'|'conflict')=>(error:unknown)=>
 error instanceof GuestCompletionRejected&&error.reason===reason;

test('one-use request-bound guest completion updates status, durable event and seller notice without review eligibility',async()=>{
 await fixture(async(db,f)=>{
  // Older READ_CANCEL tokens, including one for the same verified contact,
  // must not be upgraded silently into completion capabilities.
  const old=issueGuestCapability('READ_CANCEL',f.pepper);
  await db.query(`INSERT INTO guest_capabilities
   (id,guest_contact_id,request_id,scope,token_hash,expires_at)
   VALUES($1,$2,$3,'READ_CANCEL',$4,now()+interval '1 day')`,
   [randomUUID(),f.contact,f.id,old.tokenHash]);
  await assert.rejects(confirmGuestRequestCompletion(db,f.id,old.token,1,f.pepper),
   reject('not_found'));
  assert.notEqual(hashGuestCapability('READ_CANCEL',f.token,f.pepper),
   hashGuestCapability('COMPLETE_REQUEST',f.token,f.pepper));
  const before=await db.query<{status:string;version:number}>(`
   SELECT status::text,version FROM service_requests WHERE id=$1`,[f.id]);
  assert.deepEqual(before.rows[0],{status:'ACCEPTED',version:1});

  const result=await confirmGuestRequestCompletion(
   db,f.id,f.token,1,f.pepper);
  assert.deepEqual(result,{id:f.id,state:'completed',version:2});
  assert.deepEqual((await db.query<{status:string;version:number}>(`
   SELECT status::text,version FROM service_requests WHERE id=$1`,[f.id])).rows[0],
   {status:'COMPLETED',version:2});
  const consumed=await db.query<{consumed_at:Date|null}>(`
   SELECT consumed_at FROM guest_capabilities WHERE id=$1`,[f.capability]);
  assert.ok(consumed.rows[0]?.consumed_at instanceof Date);
  const outbox=await db.query<{topic:string;safe_payload:unknown}>(`
   SELECT topic,safe_payload FROM domain_outbox_events WHERE subject_id=$1`,[f.id]);
  assert.deepEqual(outbox.rows,[{topic:'service_request.completed',safe_payload:{}}]);
  const events=await db.query<{kind:string;actor_id:string|null;detail:unknown}>(`
   SELECT kind,actor_id::text,detail FROM service_request_events WHERE request_id=$1`,[f.id]);
  assert.deepEqual(events.rows,[{kind:'COMPLETED',actor_id:null,detail:{actor:'GUEST'}}]);
  const notices=await db.query<{audience:string;channel:string;recipient_org_id:string}>(`
   SELECT audience,channel,recipient_org_id::text FROM notification_intents
   WHERE dedupe_key=$1`,['request-completed:seller:'+f.id]);
  assert.deepEqual(notices.rows,[{
   audience:'SELLER',channel:'IN_APP',recipient_org_id:f.org,
  }]);
  assert.equal((await db.query('SELECT id FROM service_experiences WHERE request_id=$1',
   [f.id])).rowCount,0,'guest cannot receive Person-bound verified review experience');
  await assert.rejects(confirmGuestRequestCompletion(db,f.id,f.token,2,f.pepper),
   reject('not_found'));
  assert.equal((await db.query('SELECT id FROM domain_outbox_events WHERE subject_id=$1',
   [f.id])).rowCount,1,'replays must not duplicate side effects');
 });
});

test('cross-request, mismatched contact, wrong hash, expiration and stale version fail closed',async()=>{
 await fixture(async(db,f)=>{
  const other=randomUUID(),otherContact=randomUUID();
  await db.query(`INSERT INTO guest_contacts
   (id,channel,encrypted_value,digest,verified_at,expires_at)
   VALUES($1,'email','another encrypted contact',$2,now(),now()+interval '1 day')`,
   [otherContact,'guest-completion-'+randomUUID()]);
  await db.query(`UPDATE guest_capabilities SET guest_contact_id=$2
   WHERE id=$1`,[f.capability,otherContact]);
  await assert.rejects(confirmGuestRequestCompletion(db,f.id,f.token,1,f.pepper),
   reject('not_found'));
  await db.query('UPDATE guest_capabilities SET guest_contact_id=$2 WHERE id=$1',
   [f.capability,f.contact]);
  await assert.rejects(confirmGuestRequestCompletion(db,other,f.token,1,f.pepper),
   reject('not_found'));
  await assert.rejects(confirmGuestRequestCompletion(db,f.id,
   issueGuestCapability('COMPLETE_REQUEST',f.pepper).token,1,f.pepper),
   reject('not_found'));
  await assert.rejects(confirmGuestRequestCompletion(db,f.id,f.token,2,f.pepper),
   reject('conflict'));
  await db.query('UPDATE guest_capabilities SET expires_at=now()-interval \'1 second\' WHERE id=$1',
   [f.capability]);
  await assert.rejects(confirmGuestRequestCompletion(db,f.id,f.token,1,f.pepper),
   reject('not_found'));
  assert.deepEqual((await db.query<{status:string;version:number}>(`
   SELECT status::text,version FROM service_requests WHERE id=$1`,[f.id])).rows[0],
   {status:'ACCEPTED',version:1});
  assert.equal((await db.query('SELECT id FROM service_request_events WHERE request_id=$1',
   [f.id])).rowCount,0);
 });
 await fixture(async(db,f)=>{
  await assert.rejects(confirmGuestRequestCompletion(db,f.id,f.token,1,f.pepper),
   reject('conflict'));
  const row=await db.query<{consumed_at:Date|null}>(`
   SELECT consumed_at FROM guest_capabilities WHERE id=$1`,[f.capability]);
  assert.equal(row.rows[0]?.consumed_at,null);
 },'PENDING');
});
