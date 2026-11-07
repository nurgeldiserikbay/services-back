import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Client} from 'pg';
import {
 decideSellerRequest,SellerDecisionRejected,
} from '../src/modules/requests/seller-decision.transaction.js';

async function createFixtures(db:Client) {
 const userId=randomUUID(),personId=randomUUID(),orgId=randomUUID();
 const definitionId=randomUUID(),offerId=randomUUID(),contactId=randomUUID();
 const requestId=randomUUID();
 await db.query('INSERT INTO users(id) VALUES($1)',[userId]);
 await db.query('INSERT INTO persons(id,user_id) VALUES($1,$2)',[personId,userId]);
 await db.query(`INSERT INTO organizations
   (id,owner_person_id,slug,name,status)
   VALUES($1,$2,$3,'Seller fixture','ACTIVE')`,
   [orgId,personId,'seller-fixture-'+randomUUID()]);
 await db.query(`INSERT INTO service_definitions(id,code,name)
   VALUES($1,$2,'Service')`,[definitionId,'seller-test-'+randomUUID()]);
 await db.query(`INSERT INTO service_offers
   (id,definition_id,organization_id,title,status,delivery_mode,contacts)
   VALUES($1,$2,$3,'Offer','PUBLISHED','online','{}'::jsonb)`,
   [offerId,definitionId,orgId]);
 await db.query(`INSERT INTO guest_contacts
   (id,channel,encrypted_value,digest,verified_at,expires_at)
   VALUES($1,'email','encrypted',$2,now(),now()+interval '1 day')`,
   [contactId,'seller-test-'+randomUUID()]);
 await db.query(`INSERT INTO service_requests
   (id,offer_id,guest_contact_id,source_context,seller_organization_id,status)
   VALUES($1,$2,$3,'ORGANIZATION',$4,'PENDING')`,
   [requestId,offerId,contactId,orgId]);
 return {requestId,orgId,contactId};
}

test('accept succeeds once, creates customer notice, rejects conflicting decline',async()=>{
 if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL required');
 const db=new Client({connectionString:process.env.DATABASE_URL});
 await db.connect();await db.query('BEGIN');
 try{
  const f=await createFixtures(db);
  const seller={kind:'organization' as const,sellerId:f.orgId};
  await assert.rejects(decideSellerRequest(db,f.requestId,
    {kind:'organization',sellerId:randomUUID()},'accept',1),
    (e:unknown)=>e instanceof SellerDecisionRejected&&e.reason==='forbidden');
  const accepted=await decideSellerRequest(db,f.requestId,seller,'accept',1);
  assert.deepEqual(accepted,{id:f.requestId,state:'accepted',version:2,replayed:false});
  // A repeated raw transition with an already-applied version must fail.
  // Authorized replay belongs to the actor-scoped idempotency ledger.
  await assert.rejects(decideSellerRequest(db,f.requestId,seller,'accept',1),
    (e:unknown)=>e instanceof SellerDecisionRejected&&e.reason==='conflict');
  await assert.rejects(decideSellerRequest(db,f.requestId,seller,'decline',1),
    (e:unknown)=>e instanceof SellerDecisionRejected&&e.reason==='conflict');
  const notices=await db.query<{n:string;channel:string}>(
    "SELECT count(*)::text AS n,max(channel) AS channel FROM notification_intents WHERE dedupe_key=$1",
    ['request-accept:guest:'+f.requestId]);
  assert.equal(notices.rows[0].n,'1');
  assert.equal(notices.rows[0].channel,'EMAIL');
  const req=await db.query<{scheduled_start_at:Date|null;status:string}>(
    'SELECT scheduled_start_at,status FROM service_requests WHERE id=$1',[f.requestId]);
  assert.equal(req.rows[0].status,'ACCEPTED');
  assert.equal(req.rows[0].scheduled_start_at,null);
 }finally{await db.query('ROLLBACK').catch(()=>{});await db.end();}
});

test('decline does not set accepted timestamp or customer penalty',async()=>{
 if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL required');
 const db=new Client({connectionString:process.env.DATABASE_URL});
 await db.connect();await db.query('BEGIN');
 try{
  const f=await createFixtures(db);
  const result=await decideSellerRequest(db,f.requestId,
   {kind:'organization',sellerId:f.orgId},'decline',1);
  assert.equal(result.state,'declined');
  const status=await db.query<{accepted_at:Date|null;customer_penalty_suspended:boolean}>(
   'SELECT accepted_at,customer_penalty_suspended FROM service_requests WHERE id=$1',[f.requestId]);
  assert.equal(status.rows[0].accepted_at,null);
  assert.equal(status.rows[0].customer_penalty_suspended,false);
 }finally{await db.query('ROLLBACK').catch(()=>{});await db.end();}
});
