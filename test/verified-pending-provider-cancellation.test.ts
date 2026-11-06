import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cancelPendingByVerifiedSellerOwner} from
  '../src/modules/requests/verified-pending-provider-cancellation.transaction.js';
import {ProviderCancellationForbidden} from
  '../src/modules/requests/provider-cancellation-authorization.js';

const id='11111111-1111-4111-8111-111111111111';
const person='22222222-2222-4222-8222-222222222222';
const seller='33333333-3333-4333-8333-333333333333';

type Row={rows:Record<string,unknown>[]};
function fake(handler:(sql:string)=>Row){
  const statements:string[]=[];
  const db={query:async(sql:string)=>{
    statements.push(sql);
    return handler(sql);
  }};
  return {db,statements};
}

test('unverified identities and malformed versions fail before database access',async()=>{
  const {db,statements}=fake(()=>({rows:[]}));
  for(const input of [
    ['bad',person,1],[id,'bad',1],[id,person,0],[id,person,1.2],
  ] as const){
    await assert.rejects(cancelPendingByVerifiedSellerOwner(
      db as never,input[0],input[1],input[2]),ProviderCancellationForbidden);
  }
  assert.equal(statements.length,0);
});

test('foreign owner cannot impersonate original professional seller',async()=>{
  const {db,statements}=fake(sql=>{
    if(sql.includes('FROM service_requests'))return {rows:[{
      status:'PENDING',version:1,
      seller_professional_id:seller,seller_organization_id:null,
    }]};
    if(sql.includes('FROM persons p'))return {rows:[{person_id:person}]};
    return {rows:[]};
  });
  await assert.rejects(cancelPendingByVerifiedSellerOwner(
    db as never,id,person,1),ProviderCancellationForbidden);
  assert.equal(statements.length,3);
  assert.equal(statements.some(x=>x.includes('UPDATE service_requests')),false);
});

test('inactive account fails before any seller or cancellation mutation',async()=>{
  const {db,statements}=fake(sql=>sql.includes('FROM service_requests')
    ? {rows:[{status:'PENDING',version:1,
      seller_professional_id:null,seller_organization_id:seller}]}
    : {rows:[]});
  await assert.rejects(cancelPendingByVerifiedSellerOwner(
    db as never,id,person,1),ProviderCancellationForbidden);
  assert.equal(statements.length,2);
});

test('organization seller requires current active owner, never performer',async()=>{
  const {db,statements}=fake(sql=>{
    if(sql.includes('FROM service_requests'))return {rows:[{
      status:'PENDING',version:1,seller_professional_id:null,
      seller_organization_id:seller,
    }]};
    if(sql.includes('FROM persons p'))return {rows:[{person_id:person}]};
    return {rows:[]};
  });
  await assert.rejects(cancelPendingByVerifiedSellerOwner(
    db as never,id,person,1),ProviderCancellationForbidden);
  assert.equal(statements.length,3);
  assert.equal(statements.some(x=>x.includes('INSERT INTO')),false);
});

test('wrong request version fails before identity lookup',async()=>{
  const {db,statements}=fake(()=>({rows:[{
    status:'PENDING',version:2,
    seller_professional_id:seller,seller_organization_id:null,
  }]}));
  await assert.rejects(cancelPendingByVerifiedSellerOwner(
    db as never,id,person,1),ProviderCancellationForbidden);
  assert.equal(statements.length,1);
});

test('canonical UUID reaches locked request lookup before owner authorization',async()=>{
  const {db,statements}=fake(()=>({rows:[]}));
  await assert.rejects(cancelPendingByVerifiedSellerOwner(
    db as never,id,person,1),ProviderCancellationForbidden);
  assert.equal(statements.length,1);
  assert.match(statements[0],/FROM service_requests/);
  assert.match(statements[0],/FOR UPDATE/);
});

test('invalid variant and malformed UUID are rejected without SQL',async()=>{
  const {db,statements}=fake(()=>({rows:[]}));
  for(const bad of [
    '11111111-1111-4111-7111-111111111111',
    '11111111-1111-4111-811111111111',
    '11111111-1111-4111-8111-11111111111Z',
  ]){
    await assert.rejects(cancelPendingByVerifiedSellerOwner(
      db as never,bad,person,1),ProviderCancellationForbidden);
  }
  assert.equal(statements.length,0);
});
