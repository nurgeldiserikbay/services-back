import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {PoolClient} from 'pg';
import {resolveSellerDecisionAuthority} from '../src/modules/requests/seller-authority.js';

const userId='11111111-1111-4111-8111-111111111111';
const requestId='22222222-2222-4222-8222-222222222222';
const professionalId='33333333-3333-4333-8333-333333333333';
const organizationId='44444444-4444-4444-8444-444444444444';

test('seller authority rejects invalid identities before querying',async()=>{
  let calls=0;
  const db={query:async()=>{calls++;return {rows:[]}}} as unknown as Pick<PoolClient,'query'>;
  assert.deepEqual(await resolveSellerDecisionAuthority(db,'invalid',requestId),{authorized:false});
  assert.deepEqual(await resolveSellerDecisionAuthority(db,userId,'invalid'),{authorized:false});
  assert.equal(calls,0);
});

test('professional authority requires active published ownership',async()=>{
  const statements:string[]=[];
  const db={query:async(sql:string)=>{
    statements.push(sql);
    if(sql.includes('FROM service_requests'))return {rows:[{professional_id:professionalId,organization_id:null}]};
    return {rows:[{allowed:true}]};
  }} as unknown as Pick<PoolClient,'query'>;
  assert.deepEqual(await resolveSellerDecisionAuthority(db,userId,requestId),{
    authorized:true,seller:{kind:'professional',sellerId:professionalId},
  });
  assert.match(statements[0],/FOR UPDATE/);
  assert.match(statements[1],/usr\.id=\$2::uuid/);
  assert.match(statements[1],/prof\.status='PUBLISHED'/);
});

test('organization authority denies membership without OWNER or ADMIN grant',async()=>{
  const statements:string[]=[];
  const db={query:async(sql:string)=>{
    statements.push(sql);
    if(sql.includes('FROM service_requests'))return {rows:[{professional_id:null,organization_id:organizationId}]};
    return {rows:[]};
  }} as unknown as Pick<PoolClient,'query'>;
  assert.deepEqual(await resolveSellerDecisionAuthority(db,userId,requestId),{authorized:false});
  assert.match(statements[1],/membership\.role IN \('OWNER','ADMIN'\)/);
  assert.match(statements[1],/membership\.revoked_at IS NULL/);
  assert.match(statements[1],/membership\.scope IS NULL/);
});

test('ambiguous seller ownership is denied before membership lookup',async()=>{
  let calls=0;
  const db={query:async()=>{calls++;return {rows:[{
    professional_id:professionalId,organization_id:organizationId,
  }]}}} as unknown as Pick<PoolClient,'query'>;
  assert.deepEqual(await resolveSellerDecisionAuthority(db,userId,requestId),{authorized:false});
  assert.equal(calls,1);
});
