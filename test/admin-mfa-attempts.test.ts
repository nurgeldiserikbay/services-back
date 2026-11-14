import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {recordAdminMfaFailure,isAdminMfaLocked} from '../src/modules/admin/admin-mfa-attempts.js';

const staffId=randomUUID();
const now=Date.now();

test('MFA failures use atomic upsert and bounded five-attempt lockout',async()=>{
 const db={query:async(sql:string,params:unknown[])=>{
  assert.match(sql,/ON CONFLICT \(staff_id\) DO UPDATE/);
  assert.match(sql,/EXISTS \(SELECT 1 FROM platform_admin_grants grants/);
  assert.match(sql,/staff\.role IN \('owner','admin','operator','auditor'\)/);
  assert.match(sql,/EXISTS \(SELECT 1 FROM platform_admin_totp_factors factor/);
  assert.match(sql,/factor\.activated_at IS NOT NULL AND factor\.disabled_at IS NULL/);
  assert.match(sql,/LEAST\(attempts.failed_attempts\+1,5\)/);
  assert.match(sql,/attempts.failed_attempts\+1>=5/);
  assert.deepEqual(params,[staffId,now,now-900000,now+900000]);
  return {rows:[{failed_attempts:5,locked_until:new Date(now+900000)}]};
 }} as never;
 assert.deepEqual(await recordAdminMfaFailure(db,staffId,now),
  {failedAttempts:5,lockedUntil:now+900000});
});

test('unknown or inactive staff does not create a lockout record',async()=>{
 const db={query:async()=>({rows:[]})} as never;
 assert.equal(await recordAdminMfaFailure(db,staffId,now),null);
});

test('malformed MFA attempt requests never access SQL',async()=>{
 let calls=0;
 const db={query:async()=>{calls++;return {rows:[]};}} as never;
 for(const [id,time] of [
  ['invalid',now],[staffId,-1],[staffId,NaN],
  [staffId,Number.MAX_SAFE_INTEGER],
  [staffId,8_640_000_000_000_000],
 ] as const){
  assert.equal(await recordAdminMfaFailure(db,id,time),null);
 }
 assert.equal(calls,0);
});

test('unexpected lockout database results fail closed',async()=>{
 for(const rows of [
  null,[{failed_attempts:6,locked_until:null}],
  [{failed_attempts:1,locked_until:'invalid'}],
  [{failed_attempts:1,locked_until:null},{failed_attempts:2,locked_until:null}],
 ]){
  const db={query:async()=>({rows})} as never;
  await assert.rejects(recordAdminMfaFailure(db,staffId,now),
   /admin_mfa_attempt_record_unavailable/);
 }
});


test('MFA lockout check reads the durable row under a database lock',async()=>{
 const db={query:async(sql:string,params:unknown[])=>{
  assert.match(sql,/FROM platform_admin_mfa_attempts/);
  assert.match(sql,/FOR UPDATE/);
  assert.deepEqual(params,[staffId]);
  return {rows:[{locked_until:new Date(now+60000),failed_attempts:5,window_started_at:new Date(now-1000)}]};
 }} as never;
 assert.equal(await isAdminMfaLocked(db,staffId,now),true);
});

test('MFA lockout check allows absent, cleared and expired locks',async()=>{
 for(const [rows,expected] of [
  [[],false],
  [[{locked_until:null,failed_attempts:1,window_started_at:new Date(now)}],false],
  [[{locked_until:new Date(now),failed_attempts:5,window_started_at:new Date(now-900001)}],false],
  [[{locked_until:new Date(now-1),failed_attempts:5,window_started_at:new Date(now-900001)}],false],
 ] as const){
  const db={query:async()=>({rows})} as never;
  assert.equal(await isAdminMfaLocked(db,staffId,now),expected);
 }
});

test('MFA lockout check rejects invalid identities without SQL',async()=>{
 let calls=0;
 const db={query:async()=>{calls++;throw Error('unexpected SQL');}} as never;
 for(const [id,time] of [
  ['invalid',now],[staffId,-1],[staffId,NaN],
  [staffId,Infinity],[staffId,1.5],
  [staffId,8_640_000_000_000_001],
 ] as const){
  assert.equal(await isAdminMfaLocked(db,id,time),true);
 }
 assert.equal(calls,0);
});

test('MFA lockout check fails closed on corrupt database responses',async()=>{
 for(const rows of [
  null,[{locked_until:'invalid'}],
  [{locked_until:new Date(NaN)}],
  [{locked_until:null},{locked_until:null}],
  [{}],
 ]){
  const db={query:async()=>({rows})} as never;
  await assert.rejects(isAdminMfaLocked(db,staffId,now),
   /admin_mfa_lockout_unavailable/);
 }
});


test('MFA lockout and failure recording propagate database outages',async()=>{
 const db={query:async()=>{throw new Error('database unavailable');}} as never;
 await assert.rejects(isAdminMfaLocked(db,staffId,now),/database unavailable/);
 await assert.rejects(recordAdminMfaFailure(db,staffId,now),/database unavailable/);
});

test('MFA failure recording rejects noninteger counters and invalid dates',async()=>{
 for(const rows of [
  [{failed_attempts:1.5,locked_until:null}],
  [{failed_attempts:0,locked_until:null}],
  [{failed_attempts:1,locked_until:new Date(NaN)}],
  [{failed_attempts:null,locked_until:null}],
  [{}],
 ]){
  const db={query:async()=>({rows})} as never;
  await assert.rejects(recordAdminMfaFailure(db,staffId,now),
   /admin_mfa_attempt_record_unavailable/);
 }
});

test('MFA lockout rejects inconsistent recent five-failure row',async()=>{
 const db={query:async()=>({rows:[{
  locked_until:null,failed_attempts:5,window_started_at:new Date(now-1000),
 }]})} as never;
 assert.equal(await isAdminMfaLocked(db,staffId,now),true);
});


test('MFA lockout rejects future-dated windows rather than treating them as clear',async()=>{
 for(const failedAttempts of [1,4,5]){
  const db={query:async()=>({rows:[{
   locked_until:null,
   failed_attempts:failedAttempts,
   window_started_at:new Date(now+60_000),
  }]})} as never;
  await assert.rejects(isAdminMfaLocked(db,staffId,now),
   /admin_mfa_lockout_unavailable/);
 }
});

test('MFA lockout and failure recording deny invalid database clients',async()=>{
 for(const db of [null,undefined,{}, {query:null}, {query:'invalid'}]){
  assert.equal(await recordAdminMfaFailure(db as never,staffId,now),null);
  assert.equal(await isAdminMfaLocked(db as never,staffId,now),true);
 }
});
