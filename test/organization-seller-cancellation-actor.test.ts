import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resolveOrganizationSellerCancellationActor} from
  '../src/modules/requests/organization-seller-cancellation-actor.js';
import {ProviderCancellationForbidden} from
  '../src/modules/requests/provider-cancellation-authorization.js';

const org='11111111-1111-4111-8111-111111111111';
const person='22222222-2222-4222-8222-222222222222';
const owner='33333333-3333-4333-8333-333333333333';

function fake(rows:unknown[],ownerPersonId=owner){
  const calls:string[]=[];
  return {calls,db:{query:async(sql:string)=>{
    calls.push(sql);
    if(sql.includes('FROM organizations o'))return {
      rows:ownerPersonId?[{owner_person_id:ownerPersonId}]:[],
    };
    return {rows};
  }}};
}

test('owner is verified from active organization and active account',async()=>{
  const {db,calls}=fake([],person);
  const actor=await resolveOrganizationSellerCancellationActor(db as never,person,org);
  assert.equal(actor.organizationMembership?.role,'OWNER');
  assert.equal(calls.length,1);
  assert.match(calls[0],/FOR SHARE OF o,p,u/);
});

test('ADMIN and OPERATOR require exact explicit cancellation scope',async()=>{
  for(const role of ['ADMIN','OPERATOR'] as const){
    const {db,calls}=fake([{organization_id:org,role,
      scope:{requests:{cancel:true}}}]);
    const actor=await resolveOrganizationSellerCancellationActor(db as never,person,org);
    assert.equal(actor.organizationMembership?.role,role);
    assert.equal(calls.length,2);
  }
});

test('missing, malformed, legacy, negative scopes and auditors are denied',async()=>{
  for(const [role,scope] of [
    ['OPERATOR',null],['ADMIN',{}],['OPERATOR',{requests:{manage:true}}],
    ['ADMIN',{requests:{cancel:'true'}}],['AUDITOR',{requests:{cancel:true}}],
    ['OPERATOR',{requests:{cancel:false}}],['OPERATOR',[]],
  ]){
    const {db}=fake([{organization_id:org,role,scope}]);
    await assert.rejects(resolveOrganizationSellerCancellationActor(
      db as never,person,org),ProviderCancellationForbidden);
  }
});

test('ambiguous membership, inactive organization and invalid identity fail closed',async()=>{
  const row={organization_id:org,role:'OPERATOR',scope:{requests:{cancel:true}}};
  const duplicate=fake([row,row]);
  await assert.rejects(resolveOrganizationSellerCancellationActor(
    duplicate.db as never,person,org),ProviderCancellationForbidden);
  const inactive=fake([row], '');
  await assert.rejects(resolveOrganizationSellerCancellationActor(
    inactive.db as never,person,org),ProviderCancellationForbidden);
  const invalid=fake([row]);
  await assert.rejects(resolveOrganizationSellerCancellationActor(
    invalid.db as never,'bad',org),ProviderCancellationForbidden);
  assert.equal(invalid.calls.length,0);
});
