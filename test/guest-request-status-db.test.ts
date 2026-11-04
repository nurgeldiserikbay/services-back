import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomBytes,randomUUID} from 'node:crypto';
import {Client} from 'pg';
import {ForbiddenException} from '@nestjs/common';
import {GuestRequestStatusService} from '../src/modules/guest-requests/guest-request-status.service.js';
import {hashGuestCapability,issueGuestCapability} from '../src/modules/guest-requests/guest-request.security.js';
import type {DatabasePool} from '../src/platform/database/database.pool.js';

const secret=randomBytes(32);
const uuid=()=>randomUUID();

test('status read validates request and proof before querying',async()=>{
  let calls=0;
  const db={query:async()=>{calls++;return {rows:[]};}} as unknown as DatabasePool;
  const service=new GuestRequestStatusService(db);
  for(const [id,token] of [['bad','short'],[uuid(),'short'],['bad','a'.repeat(43)]]){
    await assert.rejects(service.getOwnStatus(id,token),ForbiddenException);
  }
  assert.equal(calls,0);
});

test('status read returns a strict safe allowlist, not private columns',async()=>{
  const requestId=uuid(),offerId=uuid(),token=issueGuestCapability('READ_CANCEL',secret);
  const previous=process.env.GUEST_REQUEST_HMAC_KEY;
  process.env.GUEST_REQUEST_HMAC_KEY=secret.toString('base64');
  try{
    const db={query:async(_sql:string,values:unknown[])=>{
      assert.equal(values[0],requestId);
      assert.equal(values[1],hashGuestCapability('READ_CANCEL',token.token,secret));
      return {rows:[{id:requestId,offer_id:offerId,status:'ACCEPTED',
        version:2,created_at:new Date('2026-11-04T00:00:00.000Z'),
        guest_contact_id:'secret',note:'private',seller_person_id:'private'}]};
    }} as unknown as DatabasePool;
    const result=await new GuestRequestStatusService(db).getOwnStatus(requestId,token.token);
    assert.deepEqual(result,{id:requestId,service_offer_id:offerId,state:'accepted',
      version:2,created_at:'2026-11-04T00:00:00.000Z'});
    assert.equal(JSON.stringify(result).includes('private'),false);
  }finally{
    if(previous===undefined)delete process.env.GUEST_REQUEST_HMAC_KEY;
    else process.env.GUEST_REQUEST_HMAC_KEY=previous;
  }
});

test('PostgreSQL read rejects different request, mismatched contact, consumed and expired proofs',async()=>{
  if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL required');
  const client=new Client({connectionString:process.env.DATABASE_URL});
  await client.connect();
  await client.query('BEGIN');
  const previous=process.env.GUEST_REQUEST_HMAC_KEY;
  process.env.GUEST_REQUEST_HMAC_KEY=secret.toString('base64');
  try{
    const user=uuid(),person=uuid(),org=uuid(),definition=uuid(),offer=uuid();
    const contact=uuid(),otherContact=uuid(),request=uuid(),otherRequest=uuid();
    await client.query('INSERT INTO users(id) VALUES($1)',[user]);
    await client.query('INSERT INTO persons(id,user_id) VALUES($1,$2)',[person,user]);
    await client.query(`
      INSERT INTO organizations(id,owner_person_id,slug,name,status)
      VALUES($1,$2,$3,'Guest status fixture','ACTIVE')`,
      [org,person,'guest-status-'+uuid().slice(0,8)]);
    await client.query(`
      INSERT INTO service_definitions(id,code,name)
      VALUES($1,$2,'Guest status fixture')`,
      [definition,'guest-status-'+uuid().slice(0,8)]);
    await client.query(`
      INSERT INTO service_offers
        (id,definition_id,organization_id,title,status,delivery_mode,contacts)
      VALUES($1,$2,$3,'Guest status fixture','PUBLISHED','online',$4::jsonb)`,
      [offer,definition,org,JSON.stringify({methods:['guest_request']})]);
    for(const id of [contact,otherContact]){
      await client.query(`
        INSERT INTO guest_contacts(id,channel,encrypted_value,digest,verified_at,expires_at)
        VALUES($1,'email','fixture',$2,now(),now()+interval '1 day')`,
        [id,'fixture-'+uuid()]);
    }
    for(const [id,c] of [[request,contact],[otherRequest,otherContact]]){
      await client.query(`
        INSERT INTO service_requests
          (id,offer_id,guest_contact_id,source_context,
           seller_organization_id,status,note)
        VALUES($1,$2,$3,'ORGANIZATION',$4,'PENDING','private note')`,
        [id,offer,c,org]);
    }
    const valid=issueGuestCapability('READ_CANCEL',secret);
    await client.query(`
      INSERT INTO guest_capabilities
        (id,guest_contact_id,request_id,scope,token_hash,expires_at)
      VALUES($1,$2,$3,'READ_CANCEL',$4,now()+interval '1 hour')`,
      [uuid(),contact,request,valid.tokenHash]);
    const expired=issueGuestCapability('READ_CANCEL',secret);
    await client.query(`
      INSERT INTO guest_capabilities
        (id,guest_contact_id,request_id,scope,token_hash,expires_at)
      VALUES($1,$2,$3,'READ_CANCEL',$4,now()-interval '1 second')`,
      [uuid(),contact,request,expired.tokenHash]);
    const consumed=issueGuestCapability('READ_CANCEL',secret);
    await client.query(`
      INSERT INTO guest_capabilities
        (id,guest_contact_id,request_id,scope,token_hash,expires_at,consumed_at)
      VALUES($1,$2,$3,'READ_CANCEL',$4,now()+interval '1 hour',now())`,
      [uuid(),contact,request,consumed.tokenHash]);
    // Even with a valid-looking token hash, contact ownership must be checked.
    const wrongContact=issueGuestCapability('READ_CANCEL',secret);
    await client.query(`
      INSERT INTO guest_capabilities
        (id,guest_contact_id,request_id,scope,token_hash,expires_at)
      VALUES($1,$2,$3,'READ_CANCEL',$4,now()+interval '1 hour')`,
      [uuid(),otherContact,request,wrongContact.tokenHash]);
    const db={query:async(sql:string,args:unknown[])=>client.query(sql,args)} as unknown as DatabasePool;
    const service=new GuestRequestStatusService(db);
    const read=await service.getOwnStatus(request,valid.token);
    assert.equal(read.id,request);
    assert.equal(read.service_offer_id,offer);
    assert.equal(read.state,'pending');
    assert.equal(read.version,1);
    assert.equal(Object.hasOwn(read,'note'),false);
    for(const [id,token] of [[otherRequest,valid.token],
      [request,expired.token],[request,consumed.token],
      [request,wrongContact.token],[request,randomBytes(32).toString('base64url')]]){
      await assert.rejects(service.getOwnStatus(id,token),ForbiddenException);
    }
  }finally{
    await client.query('ROLLBACK').catch(()=>{});
    await client.end();
    if(previous===undefined)delete process.env.GUEST_REQUEST_HMAC_KEY;
    else process.env.GUEST_REQUEST_HMAC_KEY=previous;
  }
});
