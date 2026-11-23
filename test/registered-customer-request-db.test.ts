import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {Client} from 'pg';
import {
 createRegisteredCustomerRequestInTransaction,RegisteredRequestRejected,
} from '../src/modules/requests/registered-customer-request.transaction.js';

const uuid=()=>randomUUID();
const pepper=randomBytes(32);
async function fixture(db:Client){
 const customerUser=uuid(),customerPerson=uuid(),sellerUser=uuid(),sellerPerson=uuid();
 const organization=uuid(),definition=uuid(),offer=uuid();
 for(const [user,person] of [[customerUser,customerPerson],[sellerUser,sellerPerson]]){
  await db.query('INSERT INTO users(id) VALUES($1)',[user]);
  await db.query('INSERT INTO persons(id,user_id) VALUES($1,$2)',[person,user]);
 }
 await db.query(`
  INSERT INTO organizations(id,owner_person_id,slug,name,status)
  VALUES($1,$2,$3,'Registered request seller','ACTIVE')
 `,[organization,sellerPerson,'registered-'+uuid()]);
 await db.query(`
  INSERT INTO service_definitions(id,code,name)
  VALUES($1,$2,'Registered request test service')
 `,[definition,'registered-'+uuid()]);
 await db.query(`
  INSERT INTO service_offers
   (id,definition_id,organization_id,title,status,delivery_mode,contacts)
  VALUES($1,$2,$3,'Registered offer','PUBLISHED','online','{}'::jsonb)
 `,[offer,definition,organization]);
 return {customerPerson,organization,offer};
}

test('registered request transaction creates one scoped request and replays safely',async()=>{
 if(!process.env.DATABASE_URL)throw Error('DATABASE_URL required for PostgreSQL E2E');
 const db=new Client({connectionString:process.env.DATABASE_URL});
 await db.connect();
 await db.query('BEGIN');
 try{
  const f=await fixture(db);
  const input={serviceOfferId:f.offer,note:'Registered test note',consentToContact:true as const};
  const key='registered_create_20261123_001';
  const first=await createRegisteredCustomerRequestInTransaction(
   db,f.customerPerson,input,key,pepper);
  assert.equal(first.state,'pending');
  assert.equal(first.version,1);
  const repeat=await createRegisteredCustomerRequestInTransaction(
   db,f.customerPerson,input,key,pepper);
  assert.deepEqual(repeat,first);
  const request=await db.query<{
   customer_person_id:string;guest_contact_id:string|null;
   seller_organization_id:string;status:string;
  }>(`
   SELECT customer_person_id::text,guest_contact_id::text,
    seller_organization_id::text,status
   FROM service_requests WHERE id=$1::uuid
  `,[first.id]);
  assert.equal(request.rows.length,1);
  assert.equal(request.rows[0]?.customer_person_id,f.customerPerson);
  assert.equal(request.rows[0]?.guest_contact_id,null);
  assert.equal(request.rows[0]?.seller_organization_id,f.organization);
  assert.equal(request.rows[0]?.status,'PENDING');
  const sideEffects=await db.query<{events:string;notifications:string;audits:string}>(`
   SELECT
    (SELECT count(*)::text FROM domain_outbox_events
     WHERE subject_id=$1::uuid AND topic='service_request.created') AS events,
    (SELECT count(*)::text FROM notification_intents
     WHERE dedupe_key=$2) AS notifications,
    (SELECT count(*)::text FROM service_request_events
     WHERE request_id=$1::uuid AND kind='CREATED') AS audits
  `,[first.id,'request-created:seller:'+first.id]);
  assert.deepEqual(sideEffects.rows[0],{events:'1',notifications:'1',audits:'1'});
  const ledger=await db.query<{actor_scope:string;response_body:unknown}>(`
   SELECT actor_scope,response_body FROM idempotency_records
   WHERE key=$1 AND route='/account/requests'
  `,[key]);
  assert.equal(ledger.rows[0]?.actor_scope,'account:'+f.customerPerson);
  assert.ok(!JSON.stringify(ledger.rows[0]?.response_body).includes(input.note!));
  await assert.rejects(
   createRegisteredCustomerRequestInTransaction(
    db,f.customerPerson,{...input,note:'Changed'},key,pepper),
   (e:unknown)=>e instanceof RegisteredRequestRejected&&e.reason==='idempotency_conflict');
  const other=uuid();
  await assert.rejects(
   createRegisteredCustomerRequestInTransaction(db,other,input,
    'registered_create_20261123_002',pepper),
   (e:unknown)=>e instanceof RegisteredRequestRejected&&e.reason==='invalid_actor');
  // Simulate an organization suspension after offer eligibility is read.
  // The actual database handles customer, offer and transactional writes;
  // the final ACTIVE organization preflight is deliberately denied.
  const captured:string[]=[];
  const suspendedSellerQuery={
   query:async(sql:string,values?:unknown[])=>{
    captured.push(sql);
    if(/FROM organizations\\s+WHERE id=\\$1::uuid AND status='ACTIVE' FOR SHARE/.test(sql))
     return {rows:[],rowCount:0};
    return db.query(sql,values);
   },
  };
  await assert.rejects(
   createRegisteredCustomerRequestInTransaction(
    suspendedSellerQuery as never,f.customerPerson,input,
    'registered_create_20261123_org_denied',pepper),
   (e:unknown)=>e instanceof RegisteredRequestRejected&&e.reason==='unavailable_offer');
  assert.ok(captured.some(sql=>
   /FROM organizations\\s+WHERE id=\\$1::uuid AND status='ACTIVE' FOR SHARE/.test(sql)),
   'the active organization row must be explicitly locked');
  const denied=await db.query<{n:string}>(`
   SELECT count(*)::text AS n FROM service_requests
   WHERE offer_id=$1::uuid
  `,[f.offer]);
  assert.equal(denied.rows[0]?.n,'1',
   'ineligible seller must create no extra request');
  await db.query("UPDATE service_offers SET status='PAUSED' WHERE id=$1",[f.offer]);
  await assert.rejects(
   createRegisteredCustomerRequestInTransaction(db,f.customerPerson,input,
    'registered_create_20261123_003',pepper),
   (e:unknown)=>e instanceof RegisteredRequestRejected&&e.reason==='unavailable_offer');
 }finally{
  await db.query('ROLLBACK').catch(()=>{});
  await db.end();
 }
});
