import {test} from 'node:test';
import assert from 'node:assert/strict';
import {issueAdminSessionToken} from '../src/modules/admin/admin-session-token.js';
import {authorizeAdminRead} from '../src/modules/admin/admin-authorize-read.js';

const pepper=Buffer.alloc(32,23);
const {token,tokenHash}=issueAdminSessionToken(pepper);
const now=new Date('2026-11-10T10:00:00.000Z');
const session={
  user_id:'10000000-0000-4000-8000-000000000001',
  token_hash:tokenHash,
  role:'operator',
  expires_at:new Date('2026-11-10T11:00:00.000Z'),
  revoked_at:null,
  disabled_at:null,
  mfa_verified_at:new Date('2026-11-10T09:00:00.000Z'),
};

test('admin reads require both verified MFA session and allowed capability',()=>{
  assert.deepEqual(authorizeAdminRead(token,session,pepper,now,'moderation.read'),{
    userId:session.user_id,role:'operator',
  });
  assert.equal(authorizeAdminRead(token,session,pepper,now,'audit.read'),null);
  assert.equal(authorizeAdminRead(token,{...session,role:'auditor'},pepper,now,'audit.read')?.role,'auditor');
});

test('read policy cannot authorize an expired, revoked, forged or MFA-less session',()=>{
  for(const changes of [
    {expires_at:now},
    {revoked_at:new Date('2026-11-10T09:00:00.000Z')},
    {mfa_verified_at:null},
    {disabled_at:new Date('2026-11-10T09:00:00.000Z')},
    {role:'superadmin'},
    {token_hash:'0'.repeat(64)},
  ]){
    assert.equal(authorizeAdminRead(token,{...session,...changes},pepper,now,'moderation.read'),null);
  }
  assert.equal(authorizeAdminRead('bad',session,pepper,now,'moderation.read'),null);
  assert.equal(authorizeAdminRead(token,null,pepper,now,'moderation.read'),null);
  assert.equal(authorizeAdminRead(token,session,pepper,now,'roles.grant' as never),null);
});
