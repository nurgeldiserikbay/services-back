import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Client} from 'pg';
import {
  encodeInboxCursor,parseSellerInboxFilter,requireBearerSession,
} from '../src/modules/requests/seller-inbox.contract.js';
import {readSellerInbox} from '../src/modules/requests/seller-inbox.repository.js';

async function fixture(db:Client) {
  const userId=randomUUID(),personId=randomUUID(),orgId=randomUUID();
  const definitionId=randomUUID(),offerId=randomUUID(),guestId=randomUUID();
  const id1=randomUUID(),id2=randomUUID();
  await db.query('INSERT INTO users(id) VALUES($1)',[userId]);
  await db.query('INSERT INTO persons(id,user_id) VALUES($1,$2)',[personId,userId]);
  await db.query(`INSERT INTO organizations(id,owner_person_id,slug,name,status)
     VALUES($1,$2,$3,'Test organization','ACTIVE')`,
    [orgId,personId,'seller-inbox-'+randomUUID()]);
  await db.query(`INSERT INTO service_definitions(id,code,name)
     VALUES($1,$2,'Test service')`,[definitionId,'seller-inbox-'+randomUUID()]);
  await db.query(`INSERT INTO service_offers
     (id,definition_id,organization_id,title,status,delivery_mode,contacts)
     VALUES($1,$2,$3,'Offer title','PUBLISHED','online','{}'::jsonb)`,
    [offerId,definitionId,orgId]);
  await db.query(`INSERT INTO guest_contacts
    (id,channel,encrypted_value,digest,expires_at)
    VALUES($1,'email','encrypted',$2,now()+interval '1 day')`,
    [guestId,'seller-inbox-'+randomUUID()]);
  await db.query(`INSERT INTO service_requests
    (id,offer_id,guest_contact_id,source_context,seller_organization_id,status,created_at,note)
    VALUES($1,$3,$4,'ORGANIZATION',$5,'PENDING',now()-interval '2 minutes','private note'),
          ($2,$3,$4,'ORGANIZATION',$5,'ACCEPTED',now()-interval '1 minute','private other note')`,
    [id1,id2,offerId,guestId,orgId]);
  return {userId,personId,orgId,id1,id2};
}

test('seller inbox is authorization-scoped, paginated and strips contact/notes',async()=>{
  if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL required');
  const db=new Client({connectionString:process.env.DATABASE_URL});
  await db.connect();await db.query('BEGIN');
  try{
    const f=await fixture(db),memberId=randomUUID();
    const filter=parseSellerInboxFilter({limit:'1'});
    assert.deepEqual((await readSellerInbox(db,f.userId,filter)).items,[]);
    await db.query(`INSERT INTO organization_members
      (id,organization_id,user_id,role)
      VALUES($1,$2,$3,'ADMIN')`,[memberId,f.orgId,f.userId]);
    const first=await readSellerInbox(db,f.userId,filter);
    assert.equal(first.items.length,1);
    assert.equal(first.items[0].id,f.id2);
    assert.equal(first.items[0].seller_kind,'organization');
    assert.equal(first.items[0].state,'accepted');
    assert.ok(first.next_cursor);
    assert.ok(!JSON.stringify(first).includes('private note'));
    assert.ok(!JSON.stringify(first).includes('encrypted'));
    const second=await readSellerInbox(db,f.userId,parseSellerInboxFilter({
      limit:'1',cursor:first.next_cursor!,
    }));
    assert.equal(second.items.length,1);
    assert.equal(second.items[0].id,f.id1);
    assert.equal(second.next_cursor,null);
    const pending=await readSellerInbox(db,f.userId,parseSellerInboxFilter({
      limit:'20',state:'pending',
    }));
    assert.deepEqual(pending.items.map(x=>x.id),[f.id1]);
    await db.query("UPDATE organization_members SET role='AUDITOR' WHERE id=$1",[memberId]);
    assert.deepEqual((await readSellerInbox(db,f.userId,filter)).items,[]);
    await db.query("UPDATE organization_members SET role='ADMIN',revoked_at=now() WHERE id=$1",[memberId]);
    assert.deepEqual((await readSellerInbox(db,f.userId,filter)).items,[]);
    assert.deepEqual((await readSellerInbox(db,randomUUID(),filter)).items,[]);
  }finally{await db.query('ROLLBACK').catch(()=>{});await db.end();}
});

test('inbox cursors, limits and bearer header fail closed',()=>{
  const uuid=randomUUID(),time='2026-11-04T03:00:00.000Z';
  const encoded=encodeInboxCursor(time,uuid);
  assert.deepEqual(parseSellerInboxFilter({cursor:encoded,limit:'2'}).before,
    {createdAt:time,id:uuid});
  for(const bad of [{limit:'0'},{limit:'51'},{limit:'1.5'},
    {state:'all'},{cursor:'not-valid'},{cursor:'###'}]){
    assert.throws(()=>parseSellerInboxFilter(bad));
  }
  assert.match(requireBearerSession('Bearer '+'a'.repeat(43)),/^[a-zA-Z0-9_-]{43}$/);
  for(const invalid of [null,'Bearer short','Basic '+'a'.repeat(43),'Bearer '+'a'.repeat(43)+' extra']){
    assert.throws(()=>requireBearerSession(invalid));
  }
});
