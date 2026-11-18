import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomBytes,randomUUID} from 'node:crypto';
import {Client} from 'pg';
import type {PoolClient} from 'pg';
import {createGuestRequestInTransaction,GuestRequestRejected} from '../src/modules/guest-requests/guest-request.transaction.js';
import {issueGuestCapability} from '../src/modules/guest-requests/guest-request.security.js';

/** Independent committed clients: a profile transition must invalidate a guest
 * create attempt waiting on its profile lock, even if offer pre-check passed. */
test('guest personal request rejects a competing profile transition after profile-lock wait',async()=>{
 const a=new Client({connectionString:process.env.DATABASE_URL});
 const b=new Client({connectionString:process.env.DATABASE_URL});
 const pepper=randomBytes(32),encryptionKey=randomBytes(32);
 const user=randomUUID(),person=randomUUID(),profession=randomUUID();
 const definition=randomUUID(),profile=randomUUID(),offer=randomUUID();
 const contact=randomUUID(),cap=randomUUID(),proof=issueGuestCapability('CREATE_REQUEST',pepper);
 let created=false;
 try{
  await Promise.all([a.connect(),b.connect()]);
  await a.query('BEGIN');
  await a.query('INSERT INTO users(id) VALUES($1)',[user]);
  await a.query('INSERT INTO persons(id,user_id) VALUES($1,$2)',[person,user]);
  await a.query('INSERT INTO professions(id,code,name) VALUES($1,$2,$2)',[profession,profession]);
  await a.query('INSERT INTO service_definitions(id,code,name) VALUES($1,$2,$2)',[definition,definition]);
  await a.query("INSERT INTO professional_profiles(id,person_id,profession_id,slug,status) VALUES($1,$2,$3,$4,'PUBLISHED')",[profile,person,profession,profile]);
  await a.query("INSERT INTO service_offers(id,definition_id,professional_id,title,status,delivery_mode,contacts) VALUES($1,$2,$3,'Repair','PUBLISHED','online','{}'::jsonb)",[offer,definition,profile]);
  await a.query("INSERT INTO guest_contacts(id,channel,encrypted_value,digest,verified_at,expires_at) VALUES($1,'email','encrypted',$2,now(),now()+interval '1 day')",[contact,randomUUID()]);
  await a.query("INSERT INTO guest_capabilities(id,guest_contact_id,scope,token_hash,expires_at) VALUES($1,$2,'CREATE_REQUEST',$3,now()+interval '10 minutes')",[cap,contact,proof.tokenHash]);
  await a.query('COMMIT');created=true;

  // A changes seller eligibility and holds FOR UPDATE until B reaches its
  // own FOR SHARE lock (the offer pre-check still sees the old committed state).
  await a.query('BEGIN');
  await a.query("UPDATE professional_profiles SET status='PAUSED' WHERE id=$1",[profile]);
  await b.query('BEGIN');
  let atProfileLock!:()=>void;
  const entering=new Promise<void>(resolve=>{atProfileLock=resolve;});
  const wrapped={query:async(sql:string,params:unknown[])=>{
   if(sql.includes('FROM professional_profiles')&&sql.includes('FOR SHARE'))atProfileLock();
   return b.query(sql,params);
  }} as unknown as Pick<PoolClient,'query'>;
  const attempt=createGuestRequestInTransaction(wrapped,{
   serviceOfferId:offer,note:'Need assistance',consentToContact:true,
  },proof.token,'guest_profile_publish_race',pepper,encryptionKey);
  await entering;
  await a.query('COMMIT');
  await assert.rejects(attempt,(error:unknown)=>
   error instanceof GuestRequestRejected&&error.reason==='unavailable_offer');
  await b.query('ROLLBACK');

  assert.equal((await a.query("SELECT status FROM professional_profiles WHERE id=$1",[profile])).rows[0].status,'PAUSED');
  assert.equal((await a.query('SELECT count(*)::int AS count FROM service_requests WHERE offer_id=$1',[offer])).rows[0].count,0);
  assert.equal((await a.query('SELECT consumed_at FROM guest_capabilities WHERE id=$1',[cap])).rows[0].consumed_at,null);
 }finally{
  await b.query('ROLLBACK').catch(()=>{});
  await a.query('ROLLBACK').catch(()=>{});
  if(created){
   await a.query('BEGIN');
   try{
    await a.query('DELETE FROM guest_capabilities WHERE id=$1',[cap]);
    await a.query('DELETE FROM guest_contacts WHERE id=$1',[contact]);
    await a.query('DELETE FROM service_offers WHERE id=$1',[offer]);
    await a.query('DELETE FROM professional_profiles WHERE id=$1',[profile]);
    await a.query('DELETE FROM service_definitions WHERE id=$1',[definition]);
    await a.query('DELETE FROM professions WHERE id=$1',[profession]);
    await a.query('DELETE FROM persons WHERE id=$1',[person]);
    await a.query('DELETE FROM users WHERE id=$1',[user]);
    await a.query('COMMIT');
   }catch{
    await a.query('ROLLBACK').catch(()=>{});
    throw new Error('Failed to clean up guest/publication race fixture');
   }
  }
  await Promise.all([a.end(),b.end()]);
 }
});
