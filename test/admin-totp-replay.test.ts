import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {consumeAdminTotpCounter} from '../src/modules/admin/admin-totp-replay.js';

const staffId=randomUUID();
test('replay watermark advances using a conditional atomic upsert',async()=>{
 let calls=0;
 const db={query:async(sql:string,params:unknown[])=>{
  calls++;
  assert.match(sql,/ON CONFLICT \(staff_id\) DO UPDATE/);
  assert.match(sql,/last_consumed_counter\s*< EXCLUDED\.last_consumed_counter/);
  assert.match(sql,/staff\.disabled_at IS NULL/);
  assert.match(sql,/usr\.status='ACTIVE'/);
  assert.deepEqual(params,[staffId,123]);
  return {rows:[{last_consumed_counter:'123'}]};
 }} as never;
 assert.equal(await consumeAdminTotpCounter(db,staffId,123),true);
 assert.equal(calls,1);
});
test('replayed or unauthorized counter cannot advance watermark',async()=>{
 const db={query:async()=>({rows:[]})} as never;
 assert.equal(await consumeAdminTotpCounter(db,staffId,123),false);
});
test('malformed counter or identity never queries database',async()=>{
 let calls=0;
 const db={query:async()=>{calls++;return {rows:[]};}} as never;
 for(const [id,counter] of [
  ['bad',123],[staffId,-1],[staffId,1.2],[staffId,NaN],
  [staffId,Number.MAX_SAFE_INTEGER+1],[null,123],
 ] as const){
  assert.equal(await consumeAdminTotpCounter(db,id,counter),false);
 }
 assert.equal(calls,0);
});
test('unexpected database output is rejected',async()=>{
 for(const rows of [
  null,[{last_consumed_counter:'122'}],
  [{last_consumed_counter:'123'},{last_consumed_counter:'123'}],
 ]){
  const db={query:async()=>({rows})} as never;
  await assert.rejects(consumeAdminTotpCounter(db,staffId,123),
   /admin_totp_replay_unavailable/);
 }
});
