import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Client} from 'pg';
import {resolveSellerDecisionAuthority} from '../src/modules/requests/seller-authority.js';

async function fixture(db:Client){
  const userId=randomUUID(),personId=randomUUID(),orgId=randomUUID();
  const definitionId=randomUUID(),offerId=randomUUID(),requestId=randomUUID();
  const guestId=randomUUID();
  await db.query('INSERT INTO users(id) VALUES($1)',[userId]);
  await db.query('INSERT INTO persons(id,user_id) VALUES($1,$2)',[personId,userId]);
  await db.query(`INSERT INTO organizations(id,owner_person_id,slug,name,status)
    VALUES($1,$2,$3,'Authority fixture','ACTIVE')`,
    [orgId,personId,'authority-'+randomUUID()]);
  await db.query(`INSERT INTO service_definitions(id,code,name)
    VALUES($1,$2,'Fixture')`,[definitionId,'authority-'+randomUUID()]);
  await db.query(`INSERT INTO service_offers
    (id,definition_id,organization_id,title,status,delivery_mode,contacts)
    VALUES($1,$2,$3,'Fixture','PUBLISHED','online','{}'::jsonb)`,
    [offerId,definitionId,orgId]);
  await db.query(`INSERT INTO guest_contacts
    (id,channel,encrypted_value,digest,expires_at)
    VALUES($1,'email','encrypted',$2,now()+interval '1 day')`,
    [guestId,'authority-'+randomUUID()]);
  await db.query(`INSERT INTO service_requests(
    id,offer_id,guest_contact_id,source_context,seller_organization_id,status)
    VALUES($1,$2,$3,'ORGANIZATION',$4,'PENDING')`,
    [requestId,offerId,guestId,orgId]);
  return {userId,orgId,requestId};
}

test('organization seller gate requires active membership owner/admin and forbids auditor',async()=>{
  const db=new Client({connectionString:process.env.DATABASE_URL});
  await db.connect();await db.query('BEGIN');
  try{
    const f=await fixture(db),memberId=randomUUID();
    assert.deepEqual(await resolveSellerDecisionAuthority(db,f.userId,f.requestId),
      {authorized:false});
    await db.query(`INSERT INTO organization_members(id,organization_id,user_id,role)
      VALUES($1,$2,$3,'AUDITOR')`,[memberId,f.orgId,f.userId]);
    assert.deepEqual(await resolveSellerDecisionAuthority(db,f.userId,f.requestId),
      {authorized:false});
    await db.query(`UPDATE organization_members SET role='ADMIN' WHERE id=$1`,[memberId]);
    assert.deepEqual(await resolveSellerDecisionAuthority(db,f.userId,f.requestId),
      {authorized:true,seller:{kind:'organization',sellerId:f.orgId}});
    await db.query(`UPDATE organization_members SET revoked_at=now() WHERE id=$1`,[memberId]);
    assert.deepEqual(await resolveSellerDecisionAuthority(db,f.userId,f.requestId),
      {authorized:false});
  }finally{await db.query('ROLLBACK').catch(()=>{});await db.end();}
});

test('operator with unspecified scope and nonmembers cannot decide',async()=>{
  const db=new Client({connectionString:process.env.DATABASE_URL});
  await db.connect();await db.query('BEGIN');
  try{
    const f=await fixture(db);
    await db.query(`INSERT INTO organization_members(id,organization_id,user_id,role,scope)
      VALUES($1,$2,$3,'OPERATOR','{}'::jsonb)`,[randomUUID(),f.orgId,f.userId]);
    assert.deepEqual(await resolveSellerDecisionAuthority(db,f.userId,f.requestId),
      {authorized:false});
    assert.deepEqual(await resolveSellerDecisionAuthority(db,randomUUID(),f.requestId),
      {authorized:false});
  }finally{await db.query('ROLLBACK').catch(()=>{});await db.end();}
});
