import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomBytes,randomUUID} from 'node:crypto';
import {Client} from 'pg';
import {createGuestRequestInTransaction,GuestRequestRejected,GUEST_REQUEST_ACCESS_TTL_SECONDS} from '../src/modules/guest-requests/guest-request.transaction.js';
import {issueGuestCapability} from '../src/modules/guest-requests/guest-request.security.js';
import {VERIFY_CREATE_REQUEST_CHALLENGE_SQL} from '../src/modules/guest-requests/guest-challenge-proof.repository.js';

const uuid=()=>randomUUID();
const suffix=()=>uuid().slice(0,8);
const pepper=randomBytes(32),encryptionKey=randomBytes(32);

async function fixture(client:Client) {
  const userId=uuid(),personId=uuid(),organizationId=uuid(),definitionId=uuid();
  const offerId=uuid(),contactId=uuid(),proof=issueGuestCapability('CREATE_REQUEST',pepper);
  await client.query('INSERT INTO users(id) VALUES($1)',[userId]);
  await client.query('INSERT INTO persons(id,user_id) VALUES($1,$2)',[personId,userId]);
  await client.query(`
    INSERT INTO organizations(id,owner_person_id,slug,name,status)
    VALUES($1,$2,$3,'Fixture Organization','ACTIVE')
  `,[organizationId,personId,'guest-fixture-'+suffix()]);
  await client.query(`
    INSERT INTO service_definitions(id,code,name)
    VALUES($1,$2,'Fixture Service')
  `,[definitionId,'fixture-'+suffix()]);
  await client.query(`
    INSERT INTO service_offers
      (id,definition_id,organization_id,title,status,delivery_mode,contacts)
    VALUES($1,$2,$3,'Fixture public service','PUBLISHED','online',$4::jsonb)
  `,[offerId,definitionId,organizationId,JSON.stringify({methods:['guest_request']})]);
  await client.query(`
    INSERT INTO guest_contacts
      (id,channel,encrypted_value,digest,verified_at,expires_at)
    VALUES($1,'email','encrypted-fixture',$2,now(),now()+interval '1 day')
  `,[contactId,'test-'+uuid()]);
  await client.query(`
    INSERT INTO guest_capabilities
      (id,guest_contact_id,scope,token_hash,expires_at)
    VALUES($1,$2,'CREATE_REQUEST',$3,now()+interval '10 minutes')
  `,[uuid(),contactId,proof.tokenHash]);
  return {offerId,organizationId,contactId,proof:proof.token};
}

test('create guest request atomically, replay same key without duplicate events or secrets',async()=>{
  if(!process.env.DATABASE_URL) throw new Error('DATABASE_URL must be set for Postgres test');
  const client=new Client({connectionString:process.env.DATABASE_URL});
  await client.connect();
  await client.query('BEGIN');
  try {
    const f=await fixture(client);
    const body={serviceOfferId:f.offerId,note:'Need help',consentToContact:true as const};
    const first=await createGuestRequestInTransaction(client,body,f.proof,'request_2026_11_03_001',pepper,encryptionKey);
    assert.equal(first.state,'pending');
    assert.match(first.requestCapability,/^[A-Za-z0-9_-]{43}$/);
    assert.equal(GUEST_REQUEST_ACCESS_TTL_SECONDS,86400);
    // READ_CANCEL capability is valid for 24h, not 30 days.
    const proofExpiry=await client.query<{expires_at:Date;created_at:Date}>(
      `SELECT expires_at,created_at FROM guest_capabilities
       WHERE request_id=$1::uuid AND scope='READ_CANCEL'`,[first.id]);
    assert.equal(proofExpiry.rowCount,1);
    const durationMs=proofExpiry.rows[0].expires_at.getTime()-
      proofExpiry.rows[0].created_at.getTime();
    // PostgreSQL created_at uses transaction start; JS expiry is calculated
    // slightly later within that transaction. Allow clock offset up to 5 s.
    assert.ok(Math.abs(durationMs-24*60*60*1000)<5000,
      'READ_CANCEL capability must expire around 24 hours after issuance');
    assert.ok(Math.abs(new Date(first.expiresAt).getTime()-
      proofExpiry.rows[0].expires_at.getTime())<1500);

    const repeat=await createGuestRequestInTransaction(client,body,f.proof,'request_2026_11_03_001',pepper,encryptionKey);
    assert.deepEqual(repeat,first);

    const request=await client.query<{seller_organization_id:string;status:string;guest_contact_id:string}>(
      'SELECT seller_organization_id::text,status,guest_contact_id::text FROM service_requests WHERE id=$1',[first.id]);
    assert.equal(request.rows[0].seller_organization_id,f.organizationId);
    assert.equal(request.rows[0].guest_contact_id,f.contactId);
    assert.equal(request.rows[0].status,'PENDING');
    const events=await client.query<{n:string}>(
      "SELECT count(*)::text AS n FROM domain_outbox_events WHERE subject_id=$1::uuid AND topic='service_request.created'",[first.id]);
    assert.equal(events.rows[0].n,'1');
    const intents=await client.query<{n:string;audience:string;recipient_org_id:string;channel:string}>(
      "SELECT count(*)::text AS n,max(audience) AS audience,max(recipient_org_id::text) AS recipient_org_id,max(channel) AS channel FROM notification_intents WHERE dedupe_key=$1",
      ['request-created:seller:'+first.id]);
    assert.equal(intents.rows[0].n,'1');
    assert.equal(intents.rows[0].audience,'SELLER');
    assert.equal(intents.rows[0].channel,'IN_APP');
    assert.equal(intents.rows[0].recipient_org_id,f.organizationId);
    const idem=await client.query<{response_body:Record<string,unknown>}>(
      'SELECT response_body FROM idempotency_records WHERE key=$1',['request_2026_11_03_001']);
    const serialized=JSON.stringify(idem.rows[0].response_body);
    assert.ok(!serialized.includes(first.requestCapability));
    assert.ok(!serialized.includes('Need help'));

    await assert.rejects(
      createGuestRequestInTransaction(client,{...body,note:'Changed'},f.proof,
        'request_2026_11_03_001',pepper,encryptionKey),
      (e:unknown)=>e instanceof GuestRequestRejected && e.reason==='idempotency_conflict',
    );
  }finally{
    await client.query('ROLLBACK').catch(()=>{});
    await client.end();
  }
});

test('unpublished service never consumes guest proof or creates request',async()=>{
  if(!process.env.DATABASE_URL) throw new Error('DATABASE_URL must be set for Postgres test');
  const client=new Client({connectionString:process.env.DATABASE_URL});
  await client.connect();
  await client.query('BEGIN');
  try {
    const f=await fixture(client);
    await client.query("UPDATE service_offers SET status='PAUSED' WHERE id=$1",[f.offerId]);
    await assert.rejects(
      createGuestRequestInTransaction(client,{
        serviceOfferId:f.offerId,note:null,consentToContact:true,
      },f.proof,'request_2026_11_03_002',pepper,encryptionKey),
      (e:unknown)=>e instanceof GuestRequestRejected && e.reason==='unavailable_offer',
    );
    const proof=await client.query<{consumed_at:Date|null}>(
      "SELECT consumed_at FROM guest_capabilities WHERE scope='CREATE_REQUEST' AND guest_contact_id=$1",[f.contactId]);
    assert.equal(proof.rows[0].consumed_at,null);
    const requests=await client.query<{n:string}>(
      'SELECT count(*)::text AS n FROM service_requests WHERE offer_id=$1',[f.offerId]);
    assert.equal(requests.rows[0].n,'0');
  }finally{
    await client.query('ROLLBACK').catch(()=>{});
    await client.end();
  }
});

test('OTP proof SQL marks contact verified only when correct code is presented',async()=>{
  if(!process.env.DATABASE_URL) throw new Error('DATABASE_URL must be set for Postgres test');
  const client=new Client({connectionString:process.env.DATABASE_URL});
  await client.connect();await client.query('BEGIN');
  try {
    const id=uuid(),challengeId=uuid(),contactDigest='fixture-'+uuid();
    await client.query(`INSERT INTO guest_contacts
      (id,channel,encrypted_value,digest,expires_at)
      VALUES($1,'email','encrypted',$2,now()+interval '1 day')`,[id,contactDigest]);
    await client.query(`INSERT INTO guest_challenges
      (id,guest_contact_id,code_hash,purpose,expires_at)
      VALUES($1,$2,$3,'CREATE_REQUEST',now()+interval '10 minutes')`,
      [challengeId,id,'a'.repeat(64)]);
    const wrong=issueGuestCapability('CREATE_REQUEST',pepper);
    let result=await client.query<{verified:boolean}>(VERIFY_CREATE_REQUEST_CHALLENGE_SQL,[
      challengeId,'b'.repeat(64),uuid(),wrong.tokenHash,5,900]);
    assert.equal(result.rows[0].verified,false);
    const before=await client.query<{verified_at:Date|null}>(
      'SELECT verified_at FROM guest_contacts WHERE id=$1',[id]);
    assert.equal(before.rows[0].verified_at,null);
    const correct=issueGuestCapability('CREATE_REQUEST',pepper);
    result=await client.query<{verified:boolean}>(VERIFY_CREATE_REQUEST_CHALLENGE_SQL,[
      challengeId,'a'.repeat(64),uuid(),correct.tokenHash,5,900]);
    assert.equal(result.rows[0].verified,true);
    const after=await client.query<{verified_at:Date|null}>(
      'SELECT verified_at FROM guest_contacts WHERE id=$1',[id]);
    assert.ok(after.rows[0].verified_at);
  }finally{
    await client.query('ROLLBACK').catch(()=>{});
    await client.end();
  }
});
