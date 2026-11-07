import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {canPerformAdminOperation,type PlatformRole,type AdminOperation}
 from '../src/modules/admin/admin-authorization.policy.js';

const now=1_800_000_000_000;
const scope='organization:'+randomUUID();
function principal(role:PlatformRole){
 return {userId:randomUUID(),role,sessionExpiresAt:now+60_000,
  mfaVerifiedAt:now-1_000,resourceScopes:[scope]};
}
const ops:readonly AdminOperation[]=['moderation.read','moderation.decide',
 'audit.read','taxonomy.read','taxonomy.publish','platform_roles.read',
 'platform_roles.manage'];

test('role permission matrix denies ungranted operations',()=>{
 const expected:Record<PlatformRole,readonly AdminOperation[]>={
  owner:ops,
  admin:['moderation.read','moderation.decide','audit.read','taxonomy.read',
   'taxonomy.publish','platform_roles.read'],
  operator:['moderation.read','moderation.decide','taxonomy.read'],
  auditor:['moderation.read','audit.read','taxonomy.read'],
 };
 for(const role of ['owner','admin','operator','auditor'] as const)
  for(const operation of ops)
   assert.equal(canPerformAdminOperation(principal(role),operation,scope,now),
    expected[role].includes(operation),role+' '+operation);
});

test('all roles fail closed outside exact server-authorized resource scope',()=>{
 for(const role of ['owner','admin','operator','auditor'] as const){
  const p=principal(role);
  assert.equal(canPerformAdminOperation(p,'moderation.read','organization:'+randomUUID(),now),false);
  assert.equal(canPerformAdminOperation({...p,resourceScopes:[]},'moderation.read',scope,now),false);
  assert.equal(canPerformAdminOperation(p,'moderation.read','*',now),false);
 }
});

test('expired session, invalid MFA and malformed principal are denied',()=>{
 const p=principal('owner');
 for(const bad of [
  {...p,sessionExpiresAt:now},
  {...p,mfaVerifiedAt:now-15*60*1000-1},
  {...p,mfaVerifiedAt:now+1},
  {...p,userId:'invalid'},
  {...p,role:'guest'},
  {...p,resourceScopes:null},
  {...p,resourceScopes:Array.from({length:101},()=>scope)},
 ])assert.equal(canPerformAdminOperation(bad as never,'audit.read',scope,now),false);
 assert.equal(canPerformAdminOperation(null,'audit.read',scope,now),false);
 assert.equal(canPerformAdminOperation(p,'invalid' as AdminOperation,scope,now),false);
});
