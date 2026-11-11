import assert from 'node:assert/strict';
import {test} from 'node:test';
import {adminSessionAllowsAction} from '../src/modules/admin/admin-session-gate.js';

const now=new Date('2026-11-11T10:00:00Z');
const valid={
 now,expiresAt:new Date('2026-11-11T11:00:00Z'),
 revokedAt:null,mfaVerifiedAt:new Date('2026-11-11T09:59:00Z'),
 staffDisabledAt:null,userStatus:'ACTIVE',role:'ADMIN',
 grants:['moderation:read'],requiredScope:'moderation:read',
};

test('admin action requires live MFA-verified active session and explicit grant',()=>{
 assert.equal(adminSessionAllowsAction(valid),true);
 const rejected=[
  {expiresAt:now},{expiresAt:new Date('2026-11-11T09:00:00Z')},
  {expiresAt:new Date('invalid')},{revokedAt:now},
  {mfaVerifiedAt:null},{mfaVerifiedAt:new Date('2026-11-11T10:01:00Z')},
  {staffDisabledAt:now},{userStatus:'SUSPENDED'},{userStatus:'DELETED'},
  {role:'UNKNOWN'},{grants:[]},{grants:['moderation:write']},
  {requiredScope:'moderation:write'},{requiredScope:'*'},
  {now:new Date('invalid')},
 ];
 for(const changes of rejected){
  assert.equal(adminSessionAllowsAction({...valid,...changes}),
   false,JSON.stringify(changes));
 }
});
