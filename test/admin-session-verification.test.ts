import {test} from 'node:test';
import assert from 'node:assert/strict';
import {issueAdminSessionToken} from '../src/modules/admin/admin-session-token.js';
import {verifyAdminSessionRecord} from '../src/modules/admin/admin-session-verification.js';

const pepper=Buffer.alloc(32,7);
const {token,tokenHash}=issueAdminSessionToken(pepper);
const now=new Date('2026-11-10T10:00:00.000Z');
const base={
  token_hash:tokenHash,
  role:'admin',
  user_id:'10000000-0000-4000-8000-000000000001',
  expires_at:new Date('2026-11-10T11:00:00.000Z'),
  revoked_at:null,
  disabled_at:null,
  mfa_verified_at:new Date('2026-11-10T09:00:00.000Z'),
};
test('valid admin session requires matching token, active expiry and MFA',()=>{
  assert.deepEqual(verifyAdminSessionRecord(token,base,pepper,now),{
    userId:base.user_id,role:'admin',
  });
  for(const role of ['owner','admin','operator','auditor']){
    assert.equal(verifyAdminSessionRecord(token,{...base,role},pepper,now)?.role,role);
  }
});
test('invalid admin session claims fail closed',()=>{
  const invalid=[
    {token_hash:'bad'}, {role:'superadmin'}, {role:'__proto__'},
    {user_id:'bad'}, {user_id:'-'.repeat(36)},
    {expires_at:null}, {expires_at:new Date(Number.NaN)},
    {expires_at:now}, {expires_at:new Date(now.getTime()-1)},
    {revoked_at:new Date('2026-11-10T09:00:00.000Z')},
    {revoked_at:undefined}, {disabled_at:undefined},
    {disabled_at:new Date('2026-11-10T09:00:00.000Z')}, {mfa_verified_at:null},
    {mfa_verified_at:new Date(Number.NaN)},
    {mfa_verified_at:new Date(now.getTime()+1)},
  ];
  for(const override of invalid){
    assert.equal(verifyAdminSessionRecord(token,{...base,...override},pepper,now),null,
      JSON.stringify(Object.keys(override)));
  }
  assert.equal(verifyAdminSessionRecord('invalid',base,pepper,now),null);
  assert.equal(verifyAdminSessionRecord(token,base,Buffer.alloc(32,8),now),null);
  assert.equal(verifyAdminSessionRecord(token,null,pepper,now),null);
  assert.equal(verifyAdminSessionRecord(token,base,pepper,new Date(Number.NaN)),null);
});
