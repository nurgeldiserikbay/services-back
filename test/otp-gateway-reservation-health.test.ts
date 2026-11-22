import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readOtpGatewayReservationHealth} from
 '../src/platform/ingress/otp-gateway-reservation-health.reference.js';

test('OTP reservation health returns only aggregate count and UTC oldest timestamp',async()=>{
 let sql='';
 const db={query:async(statement:string)=>{
  sql=statement;
  return {rows:[{
   unresolved_count:'3',
   oldest_claimed_at:new Date('2026-11-22T00:00:00.000Z'),
   idempotency_key:'do-not-expose',
   fingerprint:'do-not-expose',
  }]};
 }};
 const result=await readOtpGatewayReservationHealth(db as never);
 assert.deepEqual(result,{
  unresolvedCount:'3',oldestClaimedAt:'2026-11-22T00:00:00.000Z',
 });
 assert.deepEqual(Object.keys(result).sort(),[
  'oldestClaimedAt','unresolvedCount',
 ]);
 assert.match(sql,/WHERE status='RESERVED'/);
 assert.doesNotMatch(sql,/SELECT\s+\*/i);
 assert.doesNotMatch(sql,/idempotency_key|fingerprint|provider_ref/i);
 assert.doesNotMatch(sql,/\bUPDATE\b|\bDELETE\b|\bINSERT\b/i);
});

test('OTP reservation health preserves empty state and large bigint count',async()=>{
 const empty={query:async()=>({rows:[{
  unresolved_count:'0',oldest_claimed_at:null,
 }]})};
 assert.deepEqual(await readOtpGatewayReservationHealth(empty as never),{
  unresolvedCount:'0',oldestClaimedAt:null,
 });
 const huge={query:async()=>({rows:[{
  unresolved_count:'9007199254740993',
  oldest_claimed_at:new Date('2026-11-22T00:00:00Z'),
 }]})};
 assert.equal((await readOtpGatewayReservationHealth(huge as never))
  .unresolvedCount,'9007199254740993');
});

test('OTP reservation health fails closed with sanitized error on bad DB data',async()=>{
 const badRows=[
  [],[{unresolved_count:'1',oldest_claimed_at:null}],
  [{unresolved_count:'0',oldest_claimed_at:new Date()}],
  [{unresolved_count:'1',oldest_claimed_at:'2026-11-22'}],
  [{unresolved_count:'01',oldest_claimed_at:new Date()}],
  [{unresolved_count:'-1',oldest_claimed_at:new Date()}],
  [{unresolved_count:'1',oldest_claimed_at:new Date(NaN)}],
 ];
 for(const rows of badRows){
  const db={query:async()=>({rows})};
  await assert.rejects(readOtpGatewayReservationHealth(db as never),{
   message:'otp_gateway_reservation_health_unavailable',
  });
 }
 const failed={query:async()=>{throw new Error('SQL sensitive detail');}};
 await assert.rejects(readOtpGatewayReservationHealth(failed as never),{
  message:'otp_gateway_reservation_health_unavailable',
 });
});
