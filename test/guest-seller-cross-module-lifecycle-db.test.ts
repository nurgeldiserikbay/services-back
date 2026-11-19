import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {Client} from 'pg';
import {createGuestRequestInTransaction,GuestRequestRejected} from
 '../src/modules/guest-requests/guest-request.transaction.js';
import {issueGuestCapability} from
 '../src/modules/guest-requests/guest-request.security.js';
import {decideSellerRequest,SellerDecisionRejected} from
 '../src/modules/requests/seller-decision.transaction.js';

/**
 * Real PostgreSQL acceptance of the cross-module guest-to-seller lifecycle.
 * Use a single transaction so fixture data and events are rolled back.
 * Production HTTP authentication and external provider delivery are separate gates.
 */
async function withGuestOffer(
 run:(db:Client,fixture:{offerId:string;organizationId:string;
   contactId:string;proof:string;pepper:Buffer;encryptionKey:Buffer})=>Promise<void>,
):Promise<void>{
 if(!process.env.DATABASE_URL)throw Error('DATABASE_URL required');
 const db=new Client({connectionString:process.env.DATABASE_URL});
 await db.connect();await db.query('BEGIN');
 try{
  const person=randomUUID(),org=randomUUID(),user=randomUUID();
  const definition=randomUUID(),offer=randomUUID(),contact=randomUUID();
  const pepper=randomBytes(32),encryptionKey=randomBytes(32);
  const proof=issueGuestCapability('CREATE_REQUEST',pepper);
  await db.query('INSERT INTO users(id) VALUES($1)',[user]);
  await db.query('INSERT INTO persons(id,user_id) VALUES($1,$2)',[person,user]);
  await db.query(`INSERT INTO organizations
   (id,owner_person_id,slug,name,status)
   VALUES($1,$2,$3,'Journey seller','ACTIVE')`,
   [org,person,'journey-'+randomUUID()]);
  await db.query(`INSERT INTO service_definitions(id,code,name)
   VALUES($1,$2,'Journey service')`,[definition,'journey-'+randomUUID()]);
  await db.query(`INSERT INTO service_offers
   (id,definition_id,organization_id,title,status,delivery_mode,contacts)
   VALUES($1,$2,$3,'Journey offer','PUBLISHED','online','{}'::jsonb)`,
   [offer,definition,org]);
  await db.query(`INSERT INTO guest_contacts
   (id,channel,encrypted_value,digest,verified_at,expires_at)
   VALUES($1,'email','encrypted-test-only',$2,now(),now()+interval '1 day')`,
   [contact,'journey-'+randomUUID()]);
  await db.query(`INSERT INTO guest_capabilities
   (id,guest_contact_id,scope,token_hash,expires_at)
   VALUES($1,$2,'CREATE_REQUEST',$3,now()+interval '10 minutes')`,
   [randomUUID(),contact,proof.tokenHash]);
  await run(db,{offerId:offer,organizationId:org,contactId:contact,
   proof:proof.token,pepper,encryptionKey});
 }finally{
  await db.query('ROLLBACK').catch(()=>{});
  await db.end();
 }
}

for(const decision of ['accept','decline'] as const){
 test('guest OTP-scoped create -> seller '+decision+
  ' yields one consistent request, two outbox events, two notices',async()=>{
  await withGuestOffer(async(db,f)=>{
   const body={serviceOfferId:f.offerId,note:'A private message',
    consentToContact:true as const};
   const key='guest-journey-'+randomUUID();
   const created=await createGuestRequestInTransaction(
    db,body,f.proof,key,f.pepper,f.encryptionKey);
   assert.equal(created.state,'pending');
   assert.match(created.requestCapability,/^[A-Za-z0-9_-]{43}$/);
   const replay=await createGuestRequestInTransaction(
    db,body,f.proof,key,f.pepper,f.encryptionKey);
   assert.deepEqual(replay,created,'same key must not create another request');
   await assert.rejects(
    createGuestRequestInTransaction(db,{...body,note:'Different'},f.proof,
     key,f.pepper,f.encryptionKey),
    (error:unknown)=>error instanceof GuestRequestRejected&&
     error.reason==='idempotency_conflict');

   const forged={kind:'organization' as const,sellerId:randomUUID()};
   await assert.rejects(decideSellerRequest(db,created.id,forged,decision,1),
    (error:unknown)=>error instanceof SellerDecisionRejected&&
     error.reason==='forbidden');
   const result=await decideSellerRequest(db,created.id,
    {kind:'organization',sellerId:f.organizationId},decision,1);
   assert.deepEqual(result,{id:created.id,
    state:decision==='accept'?'accepted':'declined',version:2,replayed:false});
   await assert.rejects(decideSellerRequest(db,created.id,
    {kind:'organization',sellerId:f.organizationId},decision,1),
    (error:unknown)=>error instanceof SellerDecisionRejected&&
     error.reason==='conflict');

   const rows=await db.query<{status:string;version:number;
    seller_organization_id:string;guest_contact_id:string}>(`
    SELECT status::text,version,seller_organization_id::text,
           guest_contact_id::text
    FROM service_requests WHERE id=$1::uuid`,[created.id]);
   assert.equal(rows.rowCount,1);
   assert.deepEqual([rows.rows[0]!.status,rows.rows[0]!.version],
    [decision==='accept'?'ACCEPTED':'DECLINED',2]);
   assert.equal(rows.rows[0]!.seller_organization_id,f.organizationId);
   assert.equal(rows.rows[0]!.guest_contact_id,f.contactId);

   const events=await db.query<{topic:string;safe_payload:unknown}>(`
    SELECT topic,safe_payload FROM domain_outbox_events
    WHERE subject_id=$1::uuid ORDER BY topic`,[created.id]);
   assert.deepEqual(events.rows.map(x=>x.topic).sort(),
    ['service_request.'+(decision==='accept'?'accepted':'declined'),
     'service_request.created'].sort());
   assert.ok(events.rows.every(x=>JSON.stringify(x.safe_payload)==='{}'),
    'outbox cannot expose guest note, contact, or capability');

   const intents=await db.query<{audience:string;channel:string;
    recipient_org_id:string|null;guest_contact_id:string|null}>(`
    SELECT audience,channel,recipient_org_id::text,guest_contact_id::text
    FROM notification_intents
    WHERE dedupe_key IN ($1,$2) ORDER BY audience`,
    ['request-created:seller:'+created.id,
     'request-'+decision+':guest:'+created.id]);
   assert.equal(intents.rowCount,2);
   assert.ok(intents.rows.some(x=>x.audience==='SELLER'&&
    x.channel==='IN_APP'&&x.recipient_org_id===f.organizationId));
   assert.ok(intents.rows.some(x=>x.audience==='CLIENT'&&
    x.channel==='EMAIL'&&x.guest_contact_id===f.contactId));
  });
 });
}
