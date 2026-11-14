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
  assert.match(sql,/staff.role IN \('owner','admin','operator','auditor'\)/);
  assert.match(sql,/NOT EXISTS \(SELECT 1 FROM platform_admin_mfa_attempts attempts/);
  assert.match(sql,/attempts.failed_attempts>=5/);
  assert.match(sql,/attempts.locked_until IS NULL/);
  assert.match(sql,/attempts.locked_until>to_timestamp\(\$5::double precision\/1000\.0\)/);
  assert.match(sql,/EXISTS \(SELECT 1 FROM platform_admin_grants/);
  assert.match(sql,/EXISTS \(SELECT 1 FROM platform_admin_totp_factors factor/);
  assert.match(sql,/factor.activated_at IS NOT NULL/);
  assert.match(sql,/factor\.activated_at<=to_timestamp\(\$3::double precision\/1000\.0\)/);
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

test('session expiry outside supported Date range is rejected without SQL',async()=>{
 let queries=0;
 const db={query:async()=>{queries++;throw Error('unexpected');}} as never;
 const late=8640000000000000-1000;
 assert.equal(await createVerifiedPlatformAdminSession(
  db,{staffId,mfaVerifiedAt:late},pepper,late,
 ),null);
 assert.equal(queries,0);
});


test('admin issuance rejects invalid secret material and timestamps before SQL',async()=>{
 let queries=0;
 const db={query:async()=>{queries++;throw Error('unexpected SQL');}} as never;
 const verified={staffId,mfaVerifiedAt:now};
 for(const secret of [Buffer.alloc(0),Buffer.alloc(16),Buffer.alloc(33),'not-a-key',null]){
  assert.equal(await createVerifiedPlatformAdminSession(db,verified,secret as never,now),null);
 }
 for(const clock of [NaN,Infinity,-1,1.5,Number.MAX_SAFE_INTEGER+1]){
  assert.equal(await createVerifiedPlatformAdminSession(db,verified,pepper,clock),null);
 }
 for(const timestamp of [Infinity,1.5,Number.MAX_SAFE_INTEGER+1]){
  assert.equal(await createVerifiedPlatformAdminSession(
   db,{staffId,mfaVerifiedAt:timestamp},pepper,now,
  ),null);
 }
 assert.equal(queries,0);
});

test('admin issuance fails closed when database insertion fails',async()=>{
 const db={query:async()=>{throw new Error('database unavailable');}} as never;
 await assert.rejects(
  createVerifiedPlatformAdminSession(db,{staffId,mfaVerifiedAt:now},pepper,now),
  /database unavailable/,
 );
});
