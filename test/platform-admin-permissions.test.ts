import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {canManagePlatformStaff,canPlatformAdmin,isActivePlatformPrincipal}
 from '../src/modules/platform-admin/admin-permissions.js';

const now=Date.parse('2026-11-08T01:00:00Z');
function principal(role:'owner'|'admin'|'operator'|'auditor'){
 return {userId:randomUUID(),role,mfaVerified:true,
  sessionExpiresAt:'2026-11-08T02:00:00Z',disabled:false};
}

test('administration decisions fail closed without a verified active session',()=>{
 const valid=principal('owner');
 assert.equal(isActivePlatformPrincipal(valid,now),true);
 for(const candidate of [null,{}, {...valid,mfaVerified:false},
  {...valid,disabled:true},{...valid,sessionExpiresAt:'2026-11-08T00:00:00Z'},
  {...valid,role:'seller'},{...valid,email:'unexpected'}, {...valid,userId:'bad'},
  {...valid,sessionExpiresAt:'not-a-date'}]){
  assert.equal(canPlatformAdmin(candidate,'audit:read',now),false);
 }
});

test('platform role permission matrix never grants auditor writes or operator staff privileges',()=>{
 const owner=principal('owner'),admin=principal('admin');
 const operator=principal('operator'),auditor=principal('auditor');
 assert.equal(canPlatformAdmin(owner,'staff:manage',now),true);
 assert.equal(canPlatformAdmin(admin,'staff:manage',now),false);
 assert.equal(canPlatformAdmin(operator,'moderation:decide',now),true);
 assert.equal(canPlatformAdmin(operator,'audit:read',now),false);
 assert.equal(canPlatformAdmin(auditor,'audit:read',now),true);
 assert.equal(canPlatformAdmin(auditor,'moderation:decide',now),false);
 assert.equal(canPlatformAdmin(auditor,'taxonomy:publish',now),false);
 assert.equal(canPlatformAdmin(owner,'unknown:permission' as never,now),false);
});

test('staff management forbids role self-elevation, including different ID case',()=>{
 const owner=principal('owner'),other=randomUUID();
 assert.equal(canManagePlatformStaff(owner,owner.userId,now),false);
 assert.equal(canManagePlatformStaff(owner,owner.userId.toUpperCase(),now),false);
 assert.equal(canManagePlatformStaff(owner,other,now),true);
 assert.equal(canManagePlatformStaff(principal('admin'),other,now),false);
 assert.equal(canManagePlatformStaff(owner,'invalid',now),false);
});
