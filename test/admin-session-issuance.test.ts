import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {createVerifiedPlatformAdminSession} from '../src/modules/admin/admin-session-issuance.js';
import {hashAdminSessionToken} from '../src/modules/admin/admin-session-token.js';

const pepper=randomBytes(32);
const staffId=randomUUID();
const now=Date.now();

test('admin issuance rejects stale MFA and invalid identities before SQL',async()=>{
 let queries=0;
 const db={query:async()=>{queries++;return {rows:[]};}} as never;
 for(const verified of [
  {staffId:'invalid',mfaVerifiedAt:now},
  {staffId,mfaVerifiedAt:now-15*60*1000-1},
  {staffId,mfaVerifiedAt:now+1},
  {staffId,mfaVerifiedAt:NaN},
  {staffId,mfaVerifiedAt:-1},
 ]){
  assert.equal(await createVerifiedPlatformAdminSession(db,verified,pepper,now),null);
 }
 assert.equal(queries,0);
});

test('admin issuance rejects non-exact MFA assertions without querying SQL',async()=>{
 let queries=0;
 const db={query:async()=>{queries++;return {rows:[]};}} as never;
 const valid={staffId,mfaVerifiedAt:now};
 for(const assertion of [
  {...valid,challenge:'browser-supplied'},
  Object.assign(Object.create(null),valid),
  Object.assign(Object.create({admin:true}),valid),
  [valid],
  {staffId},
 ]){
  assert.equal(await createVerifiedPlatformAdminSession(
   db,assertion as never,pepper,now,
  ),null);
 }
 assert.equal(queries,0);
});

test('admin issuance stores a hash and requires active staff, user and grants',async()=>{
 const db={query:async(sql:string,params:unknown[])=>{
  assert.match(sql,/INSERT INTO platform_admin_sessions/);
  assert.match(sql,/staff.disabled_at IS NULL/);
  assert.match(sql,/usr.status='ACTIVE'/);
  assert.match(sql,/EXISTS \(SELECT 1 FROM platform_admin_grants/);
  assert.match(sql,/EXISTS \(SELECT 1 FROM platform_admin_totp_factors factor/);
  assert.match(sql,/factor.activated_at IS NOT NULL/);
  assert.match(sql,/factor.disabled_at IS NULL/);
  assert.equal(params[0],staffId);
  assert.match(params[1] as string,/^[0-9a-f]{64}$/);
  assert.equal(params[2],now);
  assert.equal(params[3],now+900000);
  return {rows:[{id:randomUUID()}]};
 }} as never;
 const result=await createVerifiedPlatformAdminSession(db,{staffId,mfaVerifiedAt:now},pepper,now);
 assert.ok(result);
 assert.equal(result.expiresAt,now+900000);
 assert.equal(result.token.length,43);
 assert.notEqual(result.token,hashAdminSessionToken(result.token,pepper));
});

test('admin issuance does not issue a bearer when staff lacks grants or active factor',async()=>{
 const db={query:async()=>({rows:[]})} as never;
 assert.equal(await createVerifiedPlatformAdminSession(db,{staffId,mfaVerifiedAt:now},pepper,now),null);
});

test('admin issuance denies malformed driver output',async()=>{
 for(const rows of [null,[{id:'bad'}],[{id:randomUUID()},{id:randomUUID()}]]){
  const db={query:async()=>({rows})} as never;
  await assert.rejects(
   createVerifiedPlatformAdminSession(db,{staffId,mfaVerifiedAt:now},pepper,now),
   /admin_session_creation_unavailable/,
  );
 }
});
