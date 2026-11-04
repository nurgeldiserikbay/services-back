import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomBytes,randomUUID} from 'node:crypto';
import {Client} from 'pg';
import {issueGuestCapability} from '../src/modules/guest-requests/guest-request.security.js';
import {
  cancelVerifiedGuestRequest,GuestCancellationRejected,
} from '../src/modules/requests/guest-cancel.transaction.js';

const id=()=>randomUUID();
const secret=randomBytes(32);

async function fixtures(db:Client){
  const user=id(),person=id(),org=id(),definition=id(),offer=id();
  const guest=id(),otherGuest=id(),request=id();
  await db.query('INSERT INTO users(id) VALUES($1)',[user]);
  await db.query('INSERT INTO persons(id,user_id) VALUES($1,$2)',[person,user]);
  await db.query(`INSERT INTO organizations
    (id,owner_person_id,slug,name,status)
    VALUES($1,$2,$3,'Cancel fixture','ACTIVE')`,
    [org,person,'cancel-'+id()]);
  await db.query('INSERT INTO service_definitions(id,code,name) VALUES($1,$2,$3)',
    [definition,'cancel-'+id(),'Cancel fixture']);
  await db.query(`INSERT INTO service_offers
    (id,definition_id,organization_id,title,status,delivery_mode,contacts)
    VALUES($1,$2,$3,'Cancel offer','PUBLISHED','online',$4::jsonb)`,
    [offer,definition,org,JSON.stringify({methods:['guest_request']})]);
  for(const contact of [guest,otherGuest]){
    await db.query(`INSERT INTO guest_contacts
      (id,channel,encrypted_value,digest,verified_at,expires_at)
      VALUES($1,'email','encrypted',$2,now(),now()+interval '1 day')`,
      [contact,'cancel-'+id()]);
  }
  await db.query(`INSERT INTO service_requests
    (id,offer_id,guest_contact_id,source_context,
     seller_organization_id,status)
    VALUES($1,$2,$3,'ORGANIZATION',$4,'PENDING')`,
    [request,offer,guest,org]);
  const valid=issueGuestCapability('READ_CANCEL',secret);
  const foreign=issueGuestCapability('READ_CANCEL',secret);
  for(const [contact,proof] of [[guest,valid],[otherGuest,foreign]] as const)
    await db.query(`INSERT INTO guest_capabilities
      (id,guest_contact_id,request_id,scope,token_hash,expires_at)
      VALUES($1,$2,$3,'READ_CANCEL',$4,now()+interval '1 hour')`,
      [id(),contact,request,proof.tokenHash]);
  return {request,org,guest,valid:valid.token,foreign:foreign.token};
}
async function withFixture(fn:(db:Client,f:Awaited<ReturnType<typeof fixtures>>)=>Promise<void>){
  if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL required');
  const db=new Client({connectionString:process.env.DATABASE_URL});
  await db.connect();await db.query('BEGIN');
  try{await fn(db,await fixtures(db));}
  finally{await db.query('ROLLBACK').catch(()=>{});await db.end();}
}
test('verified guest pending cancel is a single transition with exactly two notice intents',async()=>{
  await withFixture(async(db,f)=>{
    const result=await cancelVerifiedGuestRequest(db,f.request,f.valid,1,secret);
    assert.deepEqual(result,{id:f.request,state:'cancelled_by_customer',version:2});
    const request=await db.query<{status:string;version:number}>(
      'SELECT status::text,version FROM service_requests WHERE id=$1',[f.request]);
    assert.deepEqual(request.rows[0],{status:'CANCELLED_BY_CUSTOMER',version:2});
    const cancellation=await db.query<{actor:string;is_late:boolean}>(`
      SELECT actor::text,is_late FROM cancellation_events WHERE request_id=$1
    `,[f.request]);
    assert.deepEqual(cancellation.rows,[{actor:'CUSTOMER',is_late:false}]);
    const intents=await db.query<{
      audience:string;channel:string;guest_contact_id:string|null;
      recipient_org_id:string|null;
    }>(`
      SELECT audience,channel,guest_contact_id::text,recipient_org_id::text
      FROM notification_intents
      WHERE cancellation_id IN
        (SELECT id FROM cancellation_events WHERE request_id=$1)
      ORDER BY audience
    `,[f.request]);
    assert.deepEqual(intents.rows,[
      {audience:'COUNTERPARTY',channel:'IN_APP',
       guest_contact_id:null,recipient_org_id:f.org},
      {audience:'INITIATOR',channel:'EMAIL',
       guest_contact_id:f.guest,recipient_org_id:null},
    ]);
    const events=await db.query<{n:string}>(`
      SELECT count(*)::text AS n FROM domain_outbox_events
      WHERE subject_id=$1 AND topic='service_request.cancelled'
    `,[f.request]);
    assert.equal(events.rows[0].n,'1');
    const reliability=await db.query<{n:string}>(`
      SELECT count(*)::text AS n FROM reliability_events WHERE request_id=$1
    `,[f.request]);
    assert.equal(reliability.rows[0].n,'0');
  });
});
test('wrong, foreign-contact or expired proof cannot cancel or query other guest',async()=>{
  await withFixture(async(db,f)=>{
    for(const token of [f.foreign,randomBytes(32).toString('base64url')]){
      await assert.rejects(cancelVerifiedGuestRequest(db,f.request,token,1,secret),
        (e:unknown)=>e instanceof GuestCancellationRejected&&
          e.reason==='unavailable');
    }
    await db.query('UPDATE guest_capabilities SET expires_at=now()-interval \'1 second\' WHERE request_id=$1',[f.request]);
    await assert.rejects(cancelVerifiedGuestRequest(db,f.request,f.valid,1,secret),
      GuestCancellationRejected);
    const row=await db.query<{status:string}>(
      'SELECT status::text FROM service_requests WHERE id=$1',[f.request]);
    assert.equal(row.rows[0].status,'PENDING');
  });
});
test('stale expected version and duplicate cancellation cannot create extra events',async()=>{
  await withFixture(async(db,f)=>{
    await assert.rejects(cancelVerifiedGuestRequest(db,f.request,f.valid,2,secret),
      (e:unknown)=>e instanceof GuestCancellationRejected&&e.reason==='conflict');
    await cancelVerifiedGuestRequest(db,f.request,f.valid,1,secret);
    await assert.rejects(cancelVerifiedGuestRequest(db,f.request,f.valid,1,secret),
      (e:unknown)=>e instanceof GuestCancellationRejected&&e.reason==='conflict');
    const rows=await db.query<{n:string}>(
      'SELECT count(*)::text AS n FROM cancellation_events WHERE request_id=$1',[f.request]);
    assert.equal(rows.rows[0].n,'1');
  });
});
test('a notification persistence failure rolls back ALL cancellation writes',async()=>{
  await withFixture(async(db,f)=>{
    // Unique dedupe conflict is raised *after* cancellation and outbox writes.
    // A caller-owned transaction must roll back fully; emulate it with a savepoint.
    await db.query(`INSERT INTO domain_outbox_events
      (id,topic,subject_kind,subject_id,safe_payload)
      VALUES($1,'test.fixture','ServiceRequest',$2,'{}'::jsonb)`,
      [id(),f.request]);
    const topic=await db.query<{id:string}>(`
      SELECT id::text FROM domain_outbox_events
      WHERE subject_id=$1 AND topic='test.fixture'`,[f.request]);
    await db.query(`INSERT INTO notification_intents
      (id,domain_event_id,recipient_org_id,audience,channel,dedupe_key)
      VALUES($1,$2,$3,'COUNTERPARTY','IN_APP',$4)`,
      [id(),topic.rows[0].id,f.org,'cancel:counterparty:'+f.request]);
    await db.query('SAVEPOINT cancel_attempt');
    await assert.rejects(
      cancelVerifiedGuestRequest(db,f.request,f.valid,1,secret));
    await db.query('ROLLBACK TO SAVEPOINT cancel_attempt');
    const request=await db.query<{status:string;version:number}>(`
      SELECT status::text,version FROM service_requests WHERE id=$1
    `,[f.request]);
    assert.deepEqual(request.rows[0],{status:'PENDING',version:1});
    const events=await db.query<{n:string}>(`
      SELECT count(*)::text AS n FROM cancellation_events WHERE request_id=$1
    `,[f.request]);
    assert.equal(events.rows[0].n,'0');
    const outbox=await db.query<{n:string}>(`
      SELECT count(*)::text AS n FROM domain_outbox_events
      WHERE subject_id=$1 AND topic='service_request.cancelled'
    `,[f.request]);
    assert.equal(outbox.rows[0].n,'0');
  });
});
