import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Client} from 'pg';
import {confirmCustomerRequestCompletion,CustomerCompletionRejected} from
 '../src/modules/requests/customer-completion.transaction.js';

async function withFixture(
 callback:(db:Client,ids:{request:string;customer:string;seller:string})=>Promise<void>,
 options:{guest?:boolean;status?:'PENDING'|'ACCEPTED'|'DECLINED'}={},
){
 if(!process.env.DATABASE_URL)throw Error('DATABASE_URL required');
 const db=new Client({connectionString:process.env.DATABASE_URL});
 await db.connect();await db.query('BEGIN');
 try{
  const user=randomUUID(),person=randomUUID(),sellerUser=randomUUID();
  const sellerPerson=randomUUID(),seller=randomUUID(),definition=randomUUID();
  const offer=randomUUID(),request=randomUUID(),guestContact=randomUUID();
  await db.query('INSERT INTO users(id) VALUES($1),($2)',[user,sellerUser]);
  await db.query('INSERT INTO persons(id,user_id) VALUES($1,$2),($3,$4)',
   [person,user,sellerPerson,sellerUser]);
  await db.query(`INSERT INTO organizations
   (id,owner_person_id,slug,name,status)
   VALUES($1,$2,$3,'Completion fixture','ACTIVE')`,
   [seller,sellerPerson,'completion-'+randomUUID()]);
  await db.query(`INSERT INTO service_definitions(id,code,name)
   VALUES($1,$2,'Completion fixture')`,
   [definition,'completion-'+randomUUID()]);
  await db.query(`INSERT INTO service_offers
   (id,definition_id,organization_id,title,status,delivery_mode,contacts)
   VALUES($1,$2,$3,'Completion offer','PUBLISHED','online','{}'::jsonb)`,
   [offer,definition,seller]);
  if(options.guest){
   await db.query(`INSERT INTO guest_contacts
    (id,channel,encrypted_value,digest,verified_at,expires_at)
    VALUES($1,'email','test-encrypted',$2,now(),now()+interval '1 day')`,
    [guestContact,'completion-'+randomUUID()]);
  }
  await db.query(`INSERT INTO service_requests
   (id,offer_id,customer_person_id,guest_contact_id,source_context,
    seller_organization_id,status,accepted_at,note)
   VALUES($1,$2,$3,$4,'ORGANIZATION',$5,$6::"RequestStatus",
    CASE WHEN $6='ACCEPTED' THEN now() ELSE NULL END,'Private fixture note')`,
   [request,offer,options.guest?null:person,
    options.guest?guestContact:null,seller,options.status??'ACCEPTED']);
  await callback(db,{request,customer:person,seller});
 }finally{
  await db.query('ROLLBACK').catch(()=>{});
  await db.end();
 }
}

test('registered customer confirms accepted request, producing verified experience and exactly one seller notice',async()=>{
 await withFixture(async(db,f)=>{
  const before=await db.query<{version:number;status:string}>(`
   SELECT version,status::text FROM service_requests WHERE id=$1`,[f.request]);
  assert.deepEqual(before.rows[0],{version:1,status:'ACCEPTED'});
  const done=await confirmCustomerRequestCompletion(db,f.request,f.customer,1);
  assert.deepEqual(done,{id:f.request,state:'completed',version:2});
  const row=await db.query<{status:string;version:number}>(`
   SELECT status::text,version FROM service_requests WHERE id=$1`,[f.request]);
  assert.deepEqual(row.rows[0],{status:'COMPLETED',version:2});

  const experience=await db.query<{status:string;customer_id:string;confirmed_at:Date|null}>(`
   SELECT status::text,customer_id::text,confirmed_at
   FROM service_experiences WHERE request_id=$1`,[f.request]);
  assert.equal(experience.rowCount,1);
  assert.equal(experience.rows[0]!.status,'CONFIRMED');
  assert.equal(experience.rows[0]!.customer_id,f.customer);
  assert.ok(experience.rows[0]!.confirmed_at instanceof Date);

  const event=await db.query<{kind:string;actor_id:string}>(`
   SELECT kind,actor_id::text FROM service_request_events
   WHERE request_id=$1`,[f.request]);
  assert.deepEqual(event.rows,[{kind:'COMPLETED',actor_id:f.customer}]);
  const outbox=await db.query<{topic:string;safe_payload:unknown}>(`
   SELECT topic,safe_payload FROM domain_outbox_events
   WHERE subject_id=$1`,[f.request]);
  assert.deepEqual(outbox.rows,[{topic:'service_request.completed',safe_payload:{}}]);
  const intents=await db.query<{channel:string;audience:string;recipient_org_id:string}>(`
   SELECT channel,audience,recipient_org_id::text
   FROM notification_intents WHERE dedupe_key=$1`,
   ['request-completed:seller:'+f.request]);
  assert.deepEqual(intents.rows,[{channel:'IN_APP',audience:'SELLER',
   recipient_org_id:f.seller}]);
  await assert.rejects(confirmCustomerRequestCompletion(db,f.request,f.customer,1),
   (e:unknown)=>e instanceof CustomerCompletionRejected&&e.reason==='conflict');
  assert.equal((await db.query('SELECT id FROM service_experiences WHERE request_id=$1',[f.request])).rowCount,1);
 });
});

test('unauthorized person, stale version and non-accepted request cannot complete',async()=>{
 await withFixture(async(db,f)=>{
  for(const [person,version,reason] of [
   [randomUUID(),1,'forbidden'],[f.customer,2,'conflict'],
  ] as const){
   await assert.rejects(confirmCustomerRequestCompletion(db,f.request,person,version),
    (e:unknown)=>e instanceof CustomerCompletionRejected&&e.reason===reason);
  }
  assert.equal((await db.query('SELECT id FROM service_experiences WHERE request_id=$1',[f.request])).rowCount,0);
 });
 for(const state of ['PENDING','DECLINED'] as const){
  await withFixture(async(db,f)=>{
   await assert.rejects(confirmCustomerRequestCompletion(db,f.request,f.customer,1),
    (e:unknown)=>e instanceof CustomerCompletionRejected&&e.reason==='conflict');
   assert.equal((await db.query('SELECT id FROM service_experiences WHERE request_id=$1',[f.request])).rowCount,0);
  },{status:state});
 }
});

test('guest request cannot use registered-customer completion without scoped guest authentication',async()=>{
 await withFixture(async(db,f)=>{
  await assert.rejects(confirmCustomerRequestCompletion(db,f.request,f.customer,1),
   (e:unknown)=>e instanceof CustomerCompletionRejected&&e.reason==='forbidden');
  const states=await db.query<{status:string}>(`
   SELECT status::text FROM service_requests WHERE id=$1`,[f.request]);
  assert.equal(states.rows[0]?.status,'ACCEPTED');
  assert.equal((await db.query('SELECT id FROM service_experiences WHERE request_id=$1',[f.request])).rowCount,0);
 },{guest:true});
});
