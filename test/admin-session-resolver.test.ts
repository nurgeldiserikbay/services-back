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
  assert.match(sql,/session\.created_at<=to_timestamp\(\$2::double precision\/1000\.0\)/);
  assert.match(sql,/staff.disabled_at IS NULL/);
  assert.match(sql,/usr.status='ACTIVE'/);
  assert.match(sql,/EXISTS \(\s*SELECT 1 FROM platform_admin_totp_factors factor/);
  assert.match(sql,/factor\.activated_at IS NOT NULL/);
  assert.match(sql,/factor\.activated_at<=session\.mfa_verified_at/);
  assert.match(sql,/factor\.disabled_at IS NULL/);
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
 assert.equal(await resolvePlatformAdminSession(fakeDb([{...row(),mfa_verified_at:new Date(now-901000)}]),token,pepper,now),null);
 assert.equal(await canAccessPlatformAdminResource(fakeDb([{...row(),mfa_verified_at:new Date(now-901000)}]),token,pepper,'audit.read',org,now),false);
 assert.equal(await resolvePlatformAdminSession(fakeDb(Array.from({length:101},row)),token,pepper,now),null);
 assert.notEqual(issueSessionToken(pepper).token,token);
});

test('future-dated MFA verification cannot authenticate a privileged principal',async()=>{
 const future={...row(),mfa_verified_at:new Date(now+1)};
 assert.equal(await resolvePlatformAdminSession(fakeDb([future]),token,pepper,now),null);
 assert.equal(await canAccessPlatformAdminResource(
  fakeDb([future]),token,pepper,'audit.read',org,now),false);
});

test('admin grant resolver rejects duplicate scopes with different UUID casing',async()=>{
 const lower=org.toLowerCase();
 const upper=org.toUpperCase();
 assert.equal(await resolvePlatformAdminSession(
  fakeDb([{...row(),scope:lower},{...row(),scope:upper}]),
  token,pepper,now,
 ),null);
});

test('MFA freshness boundary accepts 15 minutes exactly and denies one millisecond later',async()=>{
 const atBoundary={...row(),mfa_verified_at:new Date(now-15*60*1000)};
 const expired={...row(),mfa_verified_at:new Date(now-15*60*1000-1)};
 assert.equal(await canAccessPlatformAdminResource(
  fakeDb([atBoundary]),token,pepper,'moderation.read',org,now),true);
 assert.equal(await canAccessPlatformAdminResource(
  fakeDb([expired]),token,pepper,'moderation.read',org,now),false);
});
test('session expiry boundary rejects an expired session, even with fresh MFA',async()=>{
 const expired={...row(),expires_at:new Date(now)};
 assert.equal(await resolvePlatformAdminSession(fakeDb([expired]),token,pepper,now),null);
});
test('joined admin grant rows must agree on principal and session timestamps',async()=>{
 const first=row();
 for(const mismatch of [
  {...row(),user_id:randomUUID()},
  {...row(),role:'operator'},
  {...row(),expires_at:new Date(now+120000)},
  {...row(),mfa_verified_at:new Date(now-2000)},
 ]){
  assert.equal(await resolvePlatformAdminSession(
   fakeDb([first,mismatch]),token,pepper,now),null);
 }
});
test('zero grants cannot authorize a resource even for an owner',async()=>{
 const noGrant={...row(),role:'owner',scope:null};
 assert.equal(await canAccessPlatformAdminResource(
  fakeDb([noGrant] as never),token,pepper,'platform_roles.manage',org,now),false);
});

test('exactly 100 unique grants remain valid; the 101st denies the whole session',async()=>{
 const grants=Array.from({length:100},()=>({...row(),scope:'organization:'+randomUUID()}));
 const principal=await resolvePlatformAdminSession(fakeDb(grants),token,pepper,now);
 assert.ok(principal);
 assert.equal(principal.resourceScopes.length,100);
 assert.equal(await resolvePlatformAdminSession(
  fakeDb([...grants,{...row(),scope:'organization:'+randomUUID()}]),token,pepper,now),null);
});
test('malformed joined rows never create partial authorization',async()=>{
 const good=row();
 for(const invalid of [
  {...row(),scope:'*'},
  {...row(),scope:null},
  {...row(),mfa_verified_at:new Date('invalid')},
  {...row(),expires_at:new Date('invalid')},
 ]){
  assert.equal(await resolvePlatformAdminSession(
   fakeDb([good,invalid] as never),token,pepper,now),null);
 }
});


test('invalid authorization clock is rejected before database access',async()=>{
 let calls=0;
 const db={query:async()=>{calls++;throw new Error('unexpected SQL');}} as never;
 for(const invalidNow of [
  -1,NaN,Infinity,-Infinity,1.5,
  8_640_000_000_000_001,Number.MAX_SAFE_INTEGER,
 ]){
  assert.equal(await resolvePlatformAdminSession(
   db,token,pepper,invalidNow,
  ),null);
 }
 assert.equal(calls,0);
});


test('admin session SQL enforces MFA freshness before returning grants',async()=>{
 let calls=0;
 const db={query:async(sql:string,params:unknown[])=>{
  calls++;
  assert.match(sql,/session\.mfa_verified_at<=to_timestamp\(\$2::double precision\/1000\.0\)/);
  assert.match(sql,/session\.mfa_verified_at>=to_timestamp\(\(\$2::double precision-900000\)\/1000\.0\)/);
  assert.deepEqual(params.slice(1),[now]);
  return {rows:[row()]};
 }} as never;
 assert.ok(await resolvePlatformAdminSession(db,token,pepper,now));
 assert.equal(calls,1);
});


test('malformed admin session driver responses fail closed',async()=>{
 for(const response of [
  null,undefined,{}, {rows:null},{rows:{}},
  {rows:[null]},{rows:[undefined]},{rows:[{}]},
 ]){
  const db={query:async()=>response} as never;
  assert.equal(await resolvePlatformAdminSession(
   db,token,pepper,now,
  ),null);
 }
});

test('database errors never become admin authorization grants',async()=>{
 const db={query:async()=>{throw new Error('database unavailable');}} as never;
 await assert.rejects(canAccessPlatformAdminResource(
  db,token,pepper,'audit.read',org,now,
 ),/database unavailable/);
});

test('admin session rejects object-coercible database principal fields',async()=>{
 let coerced=0;
 const fakeIdentity={toString(){coerced++;return uid;}};
 const fakeRole={toString(){coerced++;return 'auditor';}};
 for(const invalid of [
  {...row(),user_id:fakeIdentity},
  {...row(),role:fakeRole},
 ]){
  const db={query:async()=>({rows:[invalid]})} as never;
  assert.equal(await resolvePlatformAdminSession(db,token,pepper,now),null);
 }
 assert.equal(coerced,0);
});

test('admin session resolution denies invalid database clients without throwing',async()=>{
 for(const db of [null,undefined,{}, {query:null}, {query:'invalid'}]){
  assert.equal(await resolvePlatformAdminSession(
   db as never,token,pepper,now,
  ),null);
  assert.equal(await canAccessPlatformAdminResource(
   db as never,token,pepper,'audit.read',org,now,
  ),false);
 }
});
