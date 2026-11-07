import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Client} from 'pg';
import {readSellerInbox} from '../src/modules/requests/seller-inbox.repository.js';
import {parseSellerInboxFilter} from '../src/modules/requests/seller-inbox.contract.js';
import {resolveSellerDecisionAuthority} from '../src/modules/requests/seller-authority.js';

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
  await db.query(`UPDATE users SET status='SUSPENDED' WHERE id=$1`,[f.ownerId]);
  assert.deepEqual((await visible()).items,[]);
  assert.deepEqual(await allowed(),{authorized:false});
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
  assert.deepEqual((await readSellerInbox(db,randomUUID(),
    parseSellerInboxFilter({}))).items,[]);
 }finally{await db.query('ROLLBACK').catch(()=>{});await db.end();}
});
