import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {issueAdminSessionToken,hashAdminSessionToken} from '../src/modules/admin/admin-session-token.js';
import {revokePlatformAdminSession,revokeOwnPlatformAdminSession} from '../src/modules/admin/admin-session-revocation.js';

const pepper=randomBytes(32),token=issueAdminSessionToken(pepper).token;
const staffId=randomUUID(),now=1_800_000_000_000;

test('revocation uses admin-only hash and restricts update to the owning staff',async()=>{
 let calls=0;
 const db={query:async(sql:string,params:unknown[])=>{
  calls++;
  assert.match(sql,/UPDATE platform_admin_sessions/);
  assert.match(sql,/revoked_at IS NULL/);
  assert.match(sql,/staff_id=\$2::uuid/);
  assert.doesNotMatch(sql,/\bDELETE\b/);
  assert.deepEqual(params,[hashAdminSessionToken(token,pepper),staffId,now]);
  assert.notEqual(params[0],token);
  return {rows:[{id:randomUUID()}]};
 }} as never;
 assert.equal(await revokePlatformAdminSession(db,token,pepper,staffId,now),true);
 assert.equal(calls,1);
});

test('repeat revocation is an idempotent no-op',async()=>{
 const db={query:async()=>({rows:[]})} as never;
 assert.equal(await revokePlatformAdminSession(db,token,pepper,staffId,now),false);
});

test('invalid credentials and staff identifiers never reach database',async()=>{
 let calls=0;
 const db={query:async()=>{calls++;return {rows:[]};}} as never;
 for(const [proof,key,staff,time] of [
  ['bad',pepper,staffId,now],
  [token,Buffer.alloc(16),staffId,now],
  [token,pepper,'not-uuid',now],
  [token,pepper,staffId,-1],
  [token,pepper,staffId,NaN],
 ] as const){
  assert.equal(await revokePlatformAdminSession(db,proof,key,staff,time),false);
 }
 assert.equal(calls,0);
});

test('unexpected driver results cannot report successful revocation',async()=>{
 for(const result of [null,{rows:null},{rows:[{},{}]},{rows:[{id:'bad'}]}]){
  const db={query:async()=>result} as never;
  await assert.rejects(revokePlatformAdminSession(db,token,pepper,staffId,now),
   /admin_session_revocation_unavailable/);
 }
});


test('self-logout only updates exact token hash and does not require staff id',async()=>{
 let calls=0;
 const db={query:async(sql:string,params:unknown[])=>{
  calls++;
  assert.match(sql,/UPDATE platform_admin_sessions/);
  assert.match(sql,/WHERE token_hash=\$1/);
  assert.doesNotMatch(sql,/staff_id=/);
  assert.match(sql,/revoked_at IS NULL/);
  assert.deepEqual(params,[hashAdminSessionToken(token,pepper),now]);
  return {rows:[{id:randomUUID()}]};
 }} as never;
 assert.equal(await revokeOwnPlatformAdminSession(db,token,pepper,now),true);
 assert.equal(calls,1);
});

test('self-logout rejects invalid proofs without touching database',async()=>{
 let calls=0;
 const db={query:async()=>{calls++;return {rows:[]};}} as never;
 assert.equal(await revokeOwnPlatformAdminSession(db,'bad',pepper,now),false);
 assert.equal(await revokeOwnPlatformAdminSession(db,token,Buffer.alloc(1),now),false);
 assert.equal(await revokeOwnPlatformAdminSession(db,token,pepper,-1),false);
 assert.equal(calls,0);
 assert.equal(await revokeOwnPlatformAdminSession(db,token,pepper,now),false);
 assert.equal(calls,1);
});


test('self-logout rejects malformed database replies instead of claiming success',async()=>{
 for(const result of [null,{rows:null},{rows:[{},{}]},{rows:[{id:'bad'}]}]){
  const db={query:async()=>result} as never;
  await assert.rejects(revokeOwnPlatformAdminSession(db,token,pepper,now),
   /admin_session_revocation_unavailable/);
 }
});

test('self-logout query is guarded against future-created and already revoked sessions',async()=>{
 const db={query:async(sql:string,params:unknown[])=>{
  assert.match(sql,/created_at<=to_timestamp/);
  assert.match(sql,/revoked_at IS NULL/);
  assert.match(sql,/WHERE token_hash=\$1/);
  assert.equal(params.length,2);
  return {rows:[]};
 }} as never;
 assert.equal(await revokeOwnPlatformAdminSession(db,token,pepper,now),false);
});


test('both admin revocation paths reject out-of-range clocks without SQL',async()=>{
 let calls=0;
 const db={query:async()=>{calls++;throw Error('unexpected SQL');}} as never;
 for(const invalidNow of [
  -1,NaN,Infinity,-Infinity,1.5,
  8_640_000_000_000_001,Number.MAX_SAFE_INTEGER,
 ]){
  assert.equal(await revokePlatformAdminSession(
   db,token,pepper,staffId,invalidNow,
  ),false);
  assert.equal(await revokeOwnPlatformAdminSession(
   db,token,pepper,invalidNow,
  ),false);
 }
 assert.equal(calls,0);
});

test('session revocation denies malformed database clients before SQL',async()=>{
 for(const db of [null,undefined,{}, {query:null}, {query:'invalid'}]){
  assert.equal(await revokePlatformAdminSession(
   db as never,token,pepper,staffId,now,
  ),false);
  assert.equal(await revokeOwnPlatformAdminSession(
   db as never,token,pepper,now,
  ),false);
 }
});
