import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {issueAdminSessionToken} from '../src/modules/admin/admin-session-token.js';
import {issueSessionToken} from '../src/modules/identity/session-proof.js';
import {
 resolvePlatformAdminSession,canAccessPlatformAdminResource,
} from '../src/modules/admin/admin-session-resolver.js';

const now=1_800_000_000_000,pepper=randomBytes(32);
const token=issueAdminSessionToken(pepper).token;
const uid=randomUUID(),org='organization:'+randomUUID();
const row=()=>({user_id:uid,role:'auditor',
 expires_at:new Date(now+60000),mfa_verified_at:new Date(now-1000),
 scope:org});
const fakeDb=(items:ReturnType<typeof row>[])=>({
 query:async(sql:string,values:unknown[])=>{
  assert.match(sql,/platform_admin_sessions/);
  assert.match(sql,/revoked_at IS NULL/);
  assert.match(sql,/staff.disabled_at IS NULL/);
  assert.match(sql,/usr.status='ACTIVE'/);
  assert.match(String(values[0]),/^[a-f0-9]{64}$/);
  return {rows:items};
 }
}) as never;

test('session resolver fails closed before hitting DB for invalid tokens',async()=>{
 let called=false;
 const db={query:async()=>{called=true;throw new Error('should not query');}} as never;
 assert.equal(await resolvePlatformAdminSession(db,'not-a-token',pepper,now),null);
 assert.equal(await resolvePlatformAdminSession(db,null,pepper,now),null);
 assert.equal(called,false);
});
test('resolved current server role and scoped grants enforce auditor read-only',async()=>{
 const db=fakeDb([row()]);
 assert.equal(await canAccessPlatformAdminResource(db,token,pepper,'audit.read',org,now),true);
 assert.equal(await canAccessPlatformAdminResource(db,token,pepper,'moderation.decide',org,now),false);
 assert.equal(await canAccessPlatformAdminResource(db,token,pepper,'audit.read','organization:'+randomUUID(),now),false);
});
test('unknown, stale, duplicate or oversized sessions fail closed',async()=>{
 assert.equal(await resolvePlatformAdminSession(fakeDb([]),token,pepper,now),null);
 assert.equal(await resolvePlatformAdminSession(fakeDb([{...row(),role:'seller'}]),token,pepper,now),null);
 assert.equal(await resolvePlatformAdminSession(fakeDb([{...row(),mfa_verified_at:new Date(now-901000)}]),token,pepper,now)?.mfaVerifiedAt,now-901000);
 assert.equal(await canAccessPlatformAdminResource(fakeDb([{...row(),mfa_verified_at:new Date(now-901000)}]),token,pepper,'audit.read',org,now),false);
 assert.equal(await resolvePlatformAdminSession(fakeDb(Array.from({length:101},row)),token,pepper,now),null);
 assert.notEqual(issueSessionToken(pepper).token,token);
});
