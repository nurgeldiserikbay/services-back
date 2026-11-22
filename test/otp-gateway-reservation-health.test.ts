import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readOtpGatewayReservationHealth,readOtpGatewayReservationAgeBuckets,
 readOtpGatewayReservationSnapshot} from
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

test('OTP reservation age buckets return only four aggregate count strings',async()=>{
 let statement='';
 const db={query:async(sql:string)=>{
  statement=sql;
  return {rows:[{total:'6',recent:'1',middle:'2',older:'3',
   idempotency_key:'private'}]};
 }};
 const result=await readOtpGatewayReservationAgeBuckets(db as never);
 assert.deepEqual(result,{
  total:'6',underFiveMinutes:'1',fiveMinutesToOneHour:'2',
  oneHourOrOlder:'3',
 });
 assert.deepEqual(Object.keys(result).sort(),[
  'fiveMinutesToOneHour','oneHourOrOlder','total','underFiveMinutes',
 ]);
 assert.match(statement,/WHERE status='RESERVED'/);
 assert.match(statement,/claimed_at <= now\(\)/);
 assert.doesNotMatch(statement,/idempotency_key|fingerprint|provider_ref/i);
 assert.doesNotMatch(statement,/\bUPDATE\b|\bDELETE\b|\bINSERT\b/i);
 const empty={query:async()=>({rows:[{
  total:'0',recent:'0',middle:'0',older:'0',
 }]})};
 assert.equal((await readOtpGatewayReservationAgeBuckets(empty as never))
  .total,'0');
});

// A future-dated reservation is excluded from recent, making the bucket
// sum disagree with the total and preventing a misleading healthy snapshot.
test('OTP reservation buckets reject bad or inconsistent DB results',async()=>{
 const bad=[
  [],[{total:'2',recent:'1',middle:'0',older:'0'}],
  [{total:'1',recent:'-1',middle:'1',older:'1'}],
  [{total:'1',recent:'01',middle:'0',older:'0'}],
  [{total:'1',recent:1,middle:'0',older:'0'}],
  [{total:'0',recent:'0',middle:'0',older:'0'},{
   total:'0',recent:'0',middle:'0',older:'0'}],
 ];
 for(const rows of bad){
  await assert.rejects(
   readOtpGatewayReservationAgeBuckets({query:async()=>({rows})} as never),
   {message:'otp_gateway_reservation_health_unavailable'},
  );
 }
 await assert.rejects(
  readOtpGatewayReservationAgeBuckets({
   query:async()=>{throw new Error('database secret');},
  } as never),
  {message:'otp_gateway_reservation_health_unavailable'},
 );
});

test('OTP snapshot reads count, oldest timestamp and histogram in ONE aggregate query',async()=>{
 let calls=0;
 let statement='';
 const db={query:async(sql:string)=>{
  calls++;
  statement=sql;
  return {rows:[{
   total:'6',oldest_claimed_at:new Date('2026-11-22T01:00:00Z'),
   recent:'1',middle:'2',older:'3',
   idempotency_key:'must-not-expose',
  }]};
 }};
 const result=await readOtpGatewayReservationSnapshot(db as never);
 assert.equal(calls,1);
 assert.deepEqual(result,{
  unresolvedCount:'6',oldestClaimedAt:'2026-11-22T01:00:00.000Z',
  total:'6',underFiveMinutes:'1',fiveMinutesToOneHour:'2',
  oneHourOrOlder:'3',
 });
 assert.match(statement,/min\(claimed_at\)/);
 assert.match(statement,/claimed_at <= now\(\)/);
 assert.match(statement,/WHERE status='RESERVED'/);
 assert.doesNotMatch(statement,/idempotency_key|fingerprint|provider_ref/i);
 assert.doesNotMatch(statement,/\bUPDATE\b|\bDELETE\b|\bINSERT\b/i);
 const empty={query:async()=>({rows:[{
  total:'0',oldest_claimed_at:null,recent:'0',middle:'0',older:'0',
 }]})};
 assert.deepEqual(await readOtpGatewayReservationSnapshot(empty as never),{
  unresolvedCount:'0',oldestClaimedAt:null,total:'0',
  underFiveMinutes:'0',fiveMinutesToOneHour:'0',oneHourOrOlder:'0',
 });
});

test('OTP snapshot rejects incomplete, inconsistent and future-skewed counts',async()=>{
 const base={total:'2',oldest_claimed_at:new Date('2026-11-22T00:00:00Z'),
  recent:'1',middle:'0',older:'1'};
 const invalid=[
  [],
  [base,base],
  [{...base,total:'3'}],
  [{...base,oldest_claimed_at:null}],
  [{...base,oldest_claimed_at:'2026-11-22'}],
  [{...base,recent:'01'}],
  [{...base,total:'-2'}],
  [{...base,oldest_claimed_at:new Date(NaN)}],
  [{...base,total:'0',recent:'0',middle:'0',older:'0'}],
 ];
 for(const rows of invalid){
  await assert.rejects(readOtpGatewayReservationSnapshot(
   {query:async()=>({rows})} as never,
  ),{message:'otp_gateway_reservation_health_unavailable'});
 }
 await assert.rejects(readOtpGatewayReservationSnapshot({
  query:async()=>{throw new Error('sensitive connection detail');},
 } as never),{message:'otp_gateway_reservation_health_unavailable'});
});
