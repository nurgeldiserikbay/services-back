import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {canChangePlatformRole} from '../src/modules/admin/admin-role-change.policy.js';
import type {VerifiedAdminPrincipal} from '../src/modules/admin/admin-authorization.policy.js';

const now=1_800_000_000_000;
const target=randomUUID();
const scope='platform_roles:'+target;
function principal(role:VerifiedAdminPrincipal['role']='owner'):VerifiedAdminPrincipal{
 return {userId:randomUUID(),role,sessionExpiresAt:now+60000,
  mfaVerifiedAt:now-1000,resourceScopes:[scope]};
}

test('platform staff role changes require owner, target scope and fresh MFA',()=>{
 const actor=principal();
 assert.equal(canChangePlatformRole(actor,target,'operator','admin',now),true);
 assert.equal(canChangePlatformRole({...actor,role:'admin'},target,'operator','admin',now),false);
 assert.equal(canChangePlatformRole({...actor,role:'auditor'},target,'operator','admin',now),false);
 assert.equal(canChangePlatformRole({...actor,resourceScopes:[]},target,'operator','admin',now),false);
 assert.equal(canChangePlatformRole({...actor,mfaVerifiedAt:now-900001},target,'operator','admin',now),false);
 assert.equal(canChangePlatformRole({...actor,sessionExpiresAt:now},target,'operator','admin',now),false);
 assert.equal(canChangePlatformRole(actor,randomUUID(),'operator','admin',now),false);
});
test('no self-edit or owner assignment, including mixed-case UUIDs',()=>{
 const actor=principal();
 const ownScope='platform_roles:'+actor.userId.toLowerCase();
 const self={...actor,resourceScopes:[ownScope]};
 assert.equal(canChangePlatformRole(self,actor.userId.toUpperCase(),'operator','admin',now),false);
 assert.equal(canChangePlatformRole(actor,target,'owner','admin',now),false);
 assert.equal(canChangePlatformRole(actor,target,'admin','owner',now),false);
 assert.equal(canChangePlatformRole(actor,target,'admin','admin',now),false);
 assert.equal(canChangePlatformRole(actor,'invalid','operator','admin',now),false);
 assert.equal(canChangePlatformRole(null,target,'operator','admin',now),false);
});
