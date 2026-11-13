import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {recordAdminMfaFailure} from '../src/modules/admin/admin-mfa-attempts.js';

const staffId=randomUUID();
const now=Date.now();

test('MFA failures use atomic upsert and bounded five-attempt lockout',async()=>{
 const db={query:async(sql:string,params:unknown[])=>{
  assert.match(sql,/ON CONFLICT \(staff_id\) DO UPDATE/);
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
