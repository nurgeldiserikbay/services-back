import assert from 'node:assert/strict';
import {test} from 'node:test';
import {issueAdminSessionToken} from '../src/modules/admin/admin-session-token.js';
import {authorizeAdminAction} from '../src/modules/admin/admin-db-authorization.js';

test('admin authorization uses hashed proof and a scoped database grant',async()=>{
 const pepper=Buffer.alloc(32,7);
 const {token,tokenHash}=issueAdminSessionToken(pepper);
 const now=new Date('2026-11-11T10:00:00Z');
 let calls=0;
 const db={async query(sql:string,params:readonly unknown[]){
  calls++;
  assert.match(sql,/platform_admin_sessions/);
  assert.match(sql,/platform_admin_grants/);
  assert.deepEqual(params,[tokenHash,'moderation:read']);
  assert.ok(!sql.includes(token));
  return {rows:[{
   expires_at:new Date('2026-11-11T11:00:00Z'),revoked_at:null,
   mfa_verified_at:new Date('2026-11-11T09:00:00Z'),
   disabled_at:null,role:'ADMIN',user_status:'ACTIVE',has_scope:true,
  }]};
 }};
 assert.equal(await authorizeAdminAction(db,'Bearer '+token,pepper,'moderation:read',now),true);
 assert.equal(calls,1);
 assert.equal(await authorizeAdminAction(db,'Basic '+token,pepper,'moderation:read',now),false);
 assert.equal(await authorizeAdminAction(db,'Bearer '+token,pepper,'*',now),false);
 assert.equal(calls,1);
});

test('admin authorization rejects absent sessions and denied grants',async()=>{
 const pepper=Buffer.alloc(32,8);
 const {token}=issueAdminSessionToken(pepper);
 const now=new Date('2026-11-11T10:00:00Z');
 const base={
  expires_at:new Date('2026-11-11T11:00:00Z'),revoked_at:null,
  mfa_verified_at:new Date('2026-11-11T09:00:00Z'),
  disabled_at:null,role:'ADMIN',user_status:'ACTIVE',has_scope:true,
 };
 for(const rows of [[],[{...base,has_scope:false}],
  [{...base,revoked_at:now}],[{...base,mfa_verified_at:null}],
  [{...base,expires_at:now}],[{...base,disabled_at:now}],
  [{...base,user_status:'SUSPENDED'}]]){
  const db={async query(){return {rows};}};
  assert.equal(await authorizeAdminAction(db,'Bearer '+token,pepper,'moderation:read',now),false);
 }
});
